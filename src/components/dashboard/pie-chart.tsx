type Slice = { label: string; value: number; color: string };

/** Lightweight donut chart (pure SVG, no dependency). Segments via
 * stroke-dasharray on stacked circles. */
export function PieChart({ data, size = 168, thickness = 28 }: { data: Slice[]; size?: number; thickness?: number }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      {total === 0 ? (
        <circle cx={cx} cy={cy} r={r} fill="none" strokeWidth={thickness} className="stroke-muted" />
      ) : (
        data.map((d, i) => {
          const dash = (d.value / total) * C;
          const seg = (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={thickness}
              strokeDasharray={`${dash} ${C - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            />
          );
          offset += dash;
          return seg;
        })
      )}
    </svg>
  );
}
