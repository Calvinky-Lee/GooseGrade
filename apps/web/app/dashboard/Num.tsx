/**
 * Number rendering for data screens — specs/06 F0.1.
 *
 * The `%` is scaled to ~0.44em and rendered inside the same element, so it reads as part of
 * the number rather than as a floating symbol. Tabular figures stop digits jittering as a
 * grade recomputes.
 *
 * `null` renders an em dash, never "0.0%" — amendment A2. A student in week one has no grade,
 * and showing them a zero would be the exact failure the correctness rule forbids.
 */
export function Num({
  value,
  decimals = 1,
  unit = '%',
  className = '',
}: {
  value: number | null | undefined;
  decimals?: number;
  unit?: string | null;
  className?: string;
}) {
  if (value == null || Number.isNaN(value)) {
    return <span className={`gg-n ${className}`}>—</span>;
  }

  return (
    <span className={`gg-n ${className}`}>
      {value.toFixed(decimals)}
      {unit ? <span className="gg-u">{unit}</span> : null}
    </span>
  );
}
