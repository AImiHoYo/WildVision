import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn";

type Tab = { id: string; label: string };

function cleanLabel(label: string): string {
  return label.replace(/^[🟢🟣🔵🟡🟠⚪⚫\s]+/u, "").trim();
}

export function AnimatedTabs({
  tabs,
  value,
  onChange,
  panelId = "studio-workspace",
  activeClass = "bg-panel text-mark shadow-[0_1px_3px_rgba(15,23,42,0.1)] ring-1 ring-black/[0.04]",
}: {
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
  panelId?: string;
  activeClass?: string;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const index = Math.max(
    0,
    tabs.findIndex((tab) => tab.id === value),
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.key !== "ArrowLeft" &&
      event.key !== "ArrowRight" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const last = tabs.length - 1;
    let next = index;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "ArrowRight") next = index >= last ? 0 : index + 1;
    else next = index <= 0 ? last : index - 1;
    onChange(tabs[next].id);
    buttonRefs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label="工作模式"
      data-key-scope="studio-field"
      onKeyDown={onKeyDown}
      onMouseLeave={() => setHoverIdx(null)}
      className="relative inline-grid grid-flow-col auto-cols-fr rounded-lg border border-line/70 bg-card/85 p-1"
    >
      {/* Hover follower pill */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-1 top-1 rounded-md bg-ink/[0.05] transition-[transform,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{
          left: 4,
          width: `calc((100% - 8px) / ${tabs.length})`,
          transform: `translate3d(${(hoverIdx ?? index) * 100}%, 0, 0)`,
          opacity: hoverIdx !== null && hoverIdx !== index ? 1 : 0,
        }}
      />
      {/* Active spring pill */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute bottom-1 top-1 rounded-md transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          activeClass,
        )}
        style={{
          left: 4,
          width: `calc((100% - 8px) / ${tabs.length})`,
          transform: `translate3d(${index * 100}%, 0, 0)`,
        }}
      />
      {tabs.map((tab, tabIndex) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              buttonRefs.current[tabIndex] = node;
            }}
            id={`mode-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            onMouseEnter={() => setHoverIdx(tabIndex)}
            className={cn(
              "relative z-10 whitespace-nowrap rounded-md px-3.5 py-1 text-xs transition-[color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark",
              selected
                ? "font-semibold text-mark"
                : "font-medium text-mute hover:text-ink",
            )}
            onClick={() => onChange(tab.id)}
          >
            {cleanLabel(tab.label)}
          </button>
        );
      })}
    </div>
  );
}
