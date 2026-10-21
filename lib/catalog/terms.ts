export const DEFAULT_TERM = 1269;
export function termInfo(id: number) {
  if (
    !Number.isInteger(id) ||
    id < 1000 ||
    id > 1999 ||
    ![1, 5, 9].includes(id % 10)
  )
    throw Error("Invalid Waterloo term.");
  const year = 1900 + Math.floor(id / 10);
  const month = id % 10;
  return {
    id,
    label: `${month === 1 ? "Winter" : month === 5 ? "Spring" : "Fall"} ${year}`,
    date: `${year}-${String(month).padStart(2, "0")}-01`,
  };
}
export function normalizeCode(s: string) {
  return s
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^([A-Z]+)(\d+[A-Z]*)$/, "$1 $2");
}
