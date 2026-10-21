import { config } from "dotenv";
config({ path: ".env.local" });
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseOfferings, OFFERINGS_URL } from "./import/validation";
import { searchOutlines, pause } from "./import/source";
async function main() {
  const resume = process.argv.includes("--resume");
  const term = 1271,
    dir = ".import-cache/1271";
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const html = execFileSync(
    "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--max-time",
      "30",
      OFFERINGS_URL,
    ],
    { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  const rows = parseOfferings(html, term);
  fs.writeFileSync(
    path.join(dir, "offerings.json"),
    JSON.stringify(rows, null, 2),
    { mode: 0o600 },
  );
  const file = path.join(dir, "discovery.json");
  const state: Record<string, any> = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : {};
  let index = 0,
    done = 0,
    stop = false;
  async function worker() {
    while (index < rows.length && !stop) {
      const row = rows[index++];
      if (resume && state[row.code]?.status === "complete") {
        done++;
        continue;
      }
      try {
        const outlines = await searchOutlines(
          row.code,
          term,
          process.env.WATERLOO_SESSION_COOKIE || "",
        );
        state[row.code] = {
          status: "complete",
          checked_at: new Date().toISOString(),
          outlines,
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        state[row.code] = { status: "error", message };
        if (message.includes("Authentication")) stop = true;
      }
      fs.writeFileSync(file + ".tmp", JSON.stringify(state, null, 2), {
        mode: 0o600,
      });
      fs.renameSync(file + ".tmp", file);
      done++;
      if (done % 50 === 0)
        console.log(
          `${done}/${rows.length} codes; ${Object.values(state).filter((s: any) => s.outlines?.length).length} codes with Winter 2027 outlines`,
        );
      await pause(700);
    }
  }
  await Promise.all([worker(), worker()]);
  const stats = {
    term,
    offerings: rows.length,
    checked: Object.values(state).filter((s: any) => s.status === "complete")
      .length,
    withOutlines: Object.values(state).filter((s: any) => s.outlines?.length)
      .length,
    sections: Object.values(state).reduce(
      (sum: number, s: any) => sum + (s.outlines?.length || 0),
      0,
    ),
    errors: Object.values(state).filter((s: any) => s.status === "error")
      .length,
  };
  console.log(JSON.stringify(stats));
  fs.writeFileSync(
    path.join(dir, "summary.json"),
    JSON.stringify(stats, null, 2),
  );
  if (stats.errors || stop) process.exitCode = 1;
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
