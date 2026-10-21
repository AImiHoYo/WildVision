import { useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { getActionColor } from "../../types";

export function NightingaleRoseSvg({
  items,
  orderedActions,
  hoveredAction,
  onHoverAction,
}: {
  items: { action: string; durationPct: number; count: number }[];
  orderedActions: string[];
  hoveredAction: string | null;
  onHoverAction: (action: string | null) => void;
}) {
  if (items.length === 0) {
    return <div className="text-xs text-mute">暂无数据</div>;
  }
  const cx = 110;
  const cy = 110;
  const maxR = 92;
  const minR = 18;
  const maxPct = Math.max(1, ...items.map((i) => i.durationPct));
  const sliceAngle = (Math.PI * 2) / Math.max(1, items.length);

  return (
    <svg viewBox="0 0 220 220" className="h-48 w-48 overflow-visible">
      {[0.33, 0.66, 1].map((r) => (
        <circle
          key={r}
          cx={cx}
          cy={cy}
          r={minR + (maxR - minR) * r}
          fill="none"
          stroke="hsl(var(--line))"
          strokeDasharray="2 2"
          strokeWidth="1"
        />
      ))}
      {items.map((item, idx) => {
        const startA = idx * sliceAngle - Math.PI / 2;
        const endA = (idx + 1) * sliceAngle - Math.PI / 2 - 0.04;
        const isHovered = hoveredAction === item.action;
        const baseR =
          minR +
          (maxR - minR) * Math.max(0.12, item.durationPct / maxPct);
        const r = isHovered ? Math.min(maxR + 5, baseR + 4) : baseR;
        const x1 = cx + r * Math.cos(startA);
        const y1 = cy + r * Math.sin(startA);
        const x2 = cx + r * Math.cos(endA);
        const y2 = cy + r * Math.sin(endA);
        const ix1 = cx + minR * Math.cos(startA);
        const iy1 = cy + minR * Math.sin(startA);
        const ix2 = cx + minR * Math.cos(endA);
        const iy2 = cy + minR * Math.sin(endA);
        const largeArc = endA - startA > Math.PI ? 1 : 0;
        const d =
          items.length === 1
            ? `M ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy}`
            : `M ${ix1} ${iy1} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${minR} ${minR} 0 ${largeArc} 0 ${ix1} ${iy1} Z`;
        const color = getActionColor(item.action, orderedActions);

        return (
          <path
            key={item.action}
            d={d}
            fill={color.bg}
            fillOpacity={
              hoveredAction === null ? 0.9 : isHovered ? 1 : 0.45
            }
            stroke="hsl(var(--panel))"
            strokeWidth="1.5"
            onMouseEnter={() => onHoverAction(item.action)}
            onMouseLeave={() => onHoverAction(null)}
            className="cursor-pointer transition-all duration-200"
          >
            <title>{`${item.action}: ${item.durationPct.toFixed(1)}% (${item.count}段)`}</title>
          </path>
        );
      })}
      <circle cx={cx} cy={cy} r={minR - 2} fill="hsl(var(--panel))" />
    </svg>
  );
}

export function TimelineDensitySvg({
  bins,
}: {
  bins: { label: string; pct: number }[];
}) {
  const width = 400;
  const height = 66;
  const padX = 12;
  const padY = 7;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const points = bins.map((b, i) => {
    const x = padX + (i / Math.max(1, bins.length - 1)) * innerW;
    const y = padY + innerH - (Math.max(4, b.pct) / 100) * innerH;
    return { x, y, label: b.label, pct: b.pct };
  });

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${height - padY} L ${points[0].x.toFixed(1)} ${height - padY} Z`;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full overflow-visible">
        <defs>
          <linearGradient id="densityGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--mark))" stopOpacity="0.42" />
            <stop offset="100%" stopColor="hsl(var(--mark))" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#densityGrad)" />
        <path
          d={linePath}
          fill="none"
          stroke="hsl(var(--mark))"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r="2.5"
            fill="hsl(var(--panel))"
            stroke="hsl(var(--mark))"
            strokeWidth="1.75"
          >
            <title>{`视频进度 ${p.label}: 相对密度 ${p.pct.toFixed(0)}%`}</title>
          </circle>
        ))}
      </svg>
      <div className="flex justify-between px-1 font-mono text-[9px] text-mute">
        <span>0%</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

export function MinimalSocraticFooter({
  chartUsage,
  questions,
}: {
  chartUsage: string;
  questions: { tag: string; question: string }[];
}) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  return (
    <div className="relative mt-2.5 shrink-0 border-t border-line pt-2 text-xs">
      <p className="truncate text-[11px] text-mute" title={chartUsage}>
        {chartUsage}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {questions.map((q, idx) => {
          const active = activeIdx === idx;
          return (
            <button
              key={q.tag}
              type="button"
              onClick={() => setActiveIdx(active ? null : idx)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-all duration-200 active:scale-[0.96] ${
                active
                  ? "border-mark bg-selection text-mark shadow-xs"
                  : "border-line bg-studio text-ink hover:border-mark/35 hover:bg-card"
              }`}
            >
              <HelpCircle size={11} className="text-mark" />
              <span>{q.tag}</span>
            </button>
          );
        })}
      </div>
      {activeIdx !== null && questions[activeIdx] && (
        <div className="absolute bottom-full left-0 right-0 z-30 mb-1.5 flex items-start justify-between gap-2 rounded-xl border border-mark/40 bg-panel px-3 py-2 text-[11px] font-medium leading-5 text-ink shadow-lg">
          <span>{questions[activeIdx].question}</span>
          <button
            type="button"
            onClick={() => setActiveIdx(null)}
            className="shrink-0 text-mute hover:text-ink"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
