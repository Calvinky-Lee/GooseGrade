export interface GradeItem {
  id: string;
  name: string;
  weight: string;
  grade: string;
  group: string;
}
export function calculateGrade(items: GradeItem[], target?: number) {
  let total = 0,
    completed = 0,
    earned = 0;
  const invalid = items.some(
    (i) =>
      i.weight.trim() === "" ||
      !Number.isFinite(Number(i.weight)) ||
      Number(i.weight) < 0 ||
      Number(i.weight) > 100 ||
      (i.grade.trim() !== "" &&
        (!Number.isFinite(Number(i.grade)) ||
          Number(i.grade) < 0 ||
          Number(i.grade) > 100)),
  );
  for (const i of items) {
    const w = Number(i.weight);
    total += w;
    if (i.grade.trim() !== "" && w > 0) {
      completed += w;
      earned += (w * Number(i.grade)) / 100;
    }
  }
  const error = invalid
    ? "Enter weights and grades between 0 and 100."
    : total > 100.000001
      ? "Assessment weights exceed 100%."
      : undefined;
  const full = Math.abs(total - 100) < 0.000001;
  return {
    total,
    completed,
    earned,
    current: !error && completed > 0 ? (earned / completed) * 100 : null,
    required:
      !error &&
      full &&
      target !== undefined &&
      Number.isFinite(target) &&
      target >= 0 &&
      target <= 100 &&
      completed < 100
        ? Math.max(0, ((target - earned) / (100 - completed)) * 100)
        : null,
    error,
  };
}
export function redistribute(
  items: GradeItem[],
  id: string,
  target: string,
): GradeItem[] {
  const source = items.find((i) => i.id === id);
  if (!source) throw Error("Assessment not found.");
  const remaining = items.filter((i) => i.id !== id);
  const recipients =
    target === "even" ? remaining : remaining.filter((i) => i.id === target);
  if (!recipients.length)
    throw Error("Choose another assessment to receive the weight.");
  if (!Number.isFinite(Number(source.weight)) || Number(source.weight) < 0)
    throw Error("Enter a valid weight first.");
  const share = Number(source.weight) / recipients.length;
  return remaining.map((i) =>
    recipients.some((r) => r.id === i.id)
      ? { ...i, weight: String(Number(i.weight) + share) }
      : { ...i },
  );
}
export function moveAssessment(
  items: GradeItem[],
  id: string,
  direction: number,
) {
  const next = items.slice();
  const i = next.findIndex((x) => x.id === id);
  const j = i + direction;
  if (i >= 0 && j >= 0 && j < next.length)
    [next[i], next[j]] = [next[j], next[i]];
  return next;
}
