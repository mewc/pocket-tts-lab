"use client";

// Dependency-free SVG bar chart with optional reference lines.
export type RefLine = { value: number; label: string; color: string; dashed?: boolean };

export default function BarChart({
  values,
  unit,
  color = "#38bdf8",
  refs = [],
  height = 160,
}: {
  values: number[];
  unit?: string;
  color?: string;
  refs?: RefLine[];
  height?: number;
}) {
  const max = Math.max(...values, ...refs.map((r) => r.value), 1) * 1.15;
  const n = values.length;
  const W = 520;
  const H = height;
  const padB = 22;
  const padL = 6;
  const gap = 6;
  const bw = (W - padL) / n - gap;
  const y = (v: number) => H - padB - (v / max) * (H - padB - 6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {/* reference lines */}
      {refs.map((r) => (
        <g key={r.label}>
          <line
            x1={padL}
            x2={W}
            y1={y(r.value)}
            y2={y(r.value)}
            stroke={r.color}
            strokeWidth={1}
            strokeDasharray={r.dashed ? "4 4" : undefined}
            opacity={0.8}
          />
          <text x={W - 2} y={y(r.value) - 3} textAnchor="end" fontSize="10" fill={r.color}>
            {r.label}
          </text>
        </g>
      ))}
      {/* bars */}
      {values.map((v, i) => {
        const x = padL + i * (bw + gap);
        const top = y(v);
        return (
          <g key={i}>
            <rect x={x} y={top} width={bw} height={H - padB - top} rx={2} fill={color} />
            <text
              x={x + bw / 2}
              y={top - 4}
              textAnchor="middle"
              fontSize="10"
              fill="#a3a3a3"
              className="tabular-nums"
            >
              {v}
              {unit}
            </text>
            <text x={x + bw / 2} y={H - 7} textAnchor="middle" fontSize="9" fill="#525252">
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
