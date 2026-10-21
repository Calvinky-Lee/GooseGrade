import { config } from "dotenv";
config({ path: ".env.local" });
import fs from "node:fs";
import { selectedTerm } from "./import/schedule";
import { termInfo } from "../lib/catalog/terms";
import path from "node:path";
import { createHash } from "node:crypto";
import { getSource, outlineText, Outline, pause } from "./import/source";
import { extractTable, extractWithModel, gradingText } from "./import/extract";
import { validateScheme, conditionalPattern } from "./import/validation";
import {
  publishOfferingManifest,
  publishScheme,
  importDatabase,
} from "./import/store";
async function main() {
  const args = process.argv.slice(2),
    apply = args.includes("--apply"),
    allowAI = args.includes("--extract"),
    maxArg = args.find((x) => x.startsWith("--max-model-calls="));
  const maxCalls = maxArg ? Number(maxArg.split("=")[1]) : 5;
  if (!Number.isInteger(maxCalls) || maxCalls < 0 || maxCalls > 2000)
    throw Error("Invalid extraction call limit.");
  const term = selectedTerm(args);
  const dir = `.import-cache/${term}`,
    offerFile = path.join(dir, "offerings.json"),
    discoveryFile = path.join(dir, "discovery.json");
  if (!fs.existsSync(offerFile) || !fs.existsSync(discoveryFile))
    throw Error("Run npm run catalog:discover first.");
  const offerings = JSON.parse(fs.readFileSync(offerFile, "utf8"));
  if (!offerings.length || offerings.some((o:any)=>o.term_id !== term || o.term !== termInfo(term).label)) throw Error("Offering manifest term mismatch.");
  const discovery = JSON.parse(fs.readFileSync(discoveryFile, "utf8"));
  const outcomeFile = path.join(dir, "outcomes.json");
  const outcomes: Record<string, any> = fs.existsSync(outcomeFile)
    ? JSON.parse(fs.readFileSync(outcomeFile, "utf8"))
    : {};
  const existingReady = new Set<string>();
  if (apply) {
    const db = importDatabase();
    for (let offset = 0; ; offset += 1000) {
      const r = await db
        .from("courses")
        .select("code")
        .eq("term", termInfo(term).label)
        .eq("validation_status", "ready")
        .order("id")
        .range(offset, offset + 999);
      if (r.error) throw Error(r.error.message);
      r.data.forEach((c) => existingReady.add(c.code));
      if (r.data.length < 1000) break;
    }
    await publishOfferingManifest(offerings);
  }
  const finalOfferings: any[] = [];
  let modelCalls = 0;
  console.log(
    `Maximum model calls: ${allowAI ? maxCalls : 0}. Source excerpts capped at 100,000 characters per call.`,
  );
  let nextOffering = 0, completed = 0;
  async function worker() {
  while (nextOffering < offerings.length) {
    const offering = offerings[nextOffering++];
    const found = discovery[offering.code];
    if (found?.status !== "complete") {
      finalOfferings.push({
        ...offering,
        outline_status: existingReady.has(offering.code) ? "ready" : "error",
        checked_at: null,
      });
      continue;
    }
    let status = "pending";
    for (const outline of found.outlines as Outline[]) {
      const key = `${offering.code}|${outline.url}`;
      try {
        const sourcePath = path.join(dir, createHash("sha256").update(outline.url).digest("hex") + ".html");
        const html = args.includes("--resume") && fs.existsSync(sourcePath)
          ? fs.readFileSync(sourcePath,"utf8")
          : await (await getSource(outline.url,process.env.WATERLOO_SESSION_COOKIE || "")).text();
        fs.writeFileSync(sourcePath, html, {mode:0o600});
        const source = outlineText(html, offering.code, term);
        const hash = createHash("sha256").update(source.text).digest("hex");
        const cachePath = path.join(dir, hash + ".json");
        fs.writeFileSync(path.join(dir, hash + ".txt"), source.text, {
          mode: 0o600,
        });
        let extraction: any;
        if (fs.existsSync(cachePath))
          extraction = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        else {
          extraction = extractTable(html, true);
          if (!extraction && !conditionalPattern.test(source.text) && allowAI && modelCalls < maxCalls && gradingText(html)) {
            modelCalls++;
            extraction = await extractWithModel(gradingText(html));
          }
          if (extraction)
            fs.writeFileSync(cachePath, JSON.stringify(extraction, null, 2), {
              mode: 0o600,
            });
        }
        const validated = validateScheme(extraction, source.text, html);
        if (!extraction && conditionalPattern.test(source.text)) validated.reasons = ["Conditional grading needs review."];
        outcomes[key] = {
          source_hash: hash,
          status: validated.status,
          reasons: validated.reasons,
          checked_at: new Date().toISOString(),
        };
        if (validated.status === "ready") {
          if (apply) {
            await publishScheme(
              {
                ...offering,
                name: outline.title?.trim() || offering.name,
                outline_url: outline.url,
                source_hash: hash,
                review_reasons: validated.reasons,
              },
              validated.assessments,
            );
            outcomes[key].published = true;
          }
          status = "ready";
        } else if (status !== "ready") status = "review";
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        outcomes[key] = { status: "error", message };
        if (message.includes("Authentication")) throw e;
        if (status !== "ready") status = "error";
      }
      fs.writeFileSync(outcomeFile, JSON.stringify(outcomes, null, 2), {
        mode: 0o600,
      });
      await pause(500);
    }
    if (existingReady.has(offering.code)) status = "ready";
    completed++;
    if(completed % 50 === 0) console.log(`Processed ${completed}/${offerings.length} offerings; ${Object.keys(outcomes).length} outline schemes`);
    finalOfferings.push({
      ...offering,
      outline_status: status,
      checked_at: found.checked_at,
    });
  }
  }
  await Promise.all([worker(),worker()]);
  if (apply) await publishOfferingManifest(finalOfferings);
  const report = {
    term,
    offeredCodes: offerings.length,
    discoveredSections: Object.values(discovery).reduce(
      (n: number, s: any) => n + (s.outlines?.length || 0),
      0,
    ),
    unavailable: Object.values(discovery).filter(
      (s: any) => s.status === "complete" && !s.outlines?.length,
    ).length,
    blocked: Object.values(discovery).filter(
      (s: any) => s.status !== "complete",
    ).length,
    modelCalls,
    apply,
    ready: Object.values(outcomes).filter((s: any) => s.status === "ready")
      .length,
    review: Object.values(outcomes).filter((s: any) => s.status === "review")
      .length,
    failed: Object.values(outcomes).filter((s: any) => s.status === "error")
      .length,
  };
  fs.writeFileSync(
    path.join(dir, "publication-summary.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  console.log(
    JSON.stringify({
      offerings: offerings.length,
      modelCalls,
      apply,
      ready: Object.values(outcomes).filter((x: any) => x.status === "ready")
        .length,
      review: Object.values(outcomes).filter((x: any) => x.status === "review")
        .length,
      errors: Object.values(outcomes).filter((x: any) => x.status === "error")
        .length,
    }),
  );
  if (Object.values(outcomes).some((x: any) => x.status === "error"))
    process.exitCode = 1;
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
