import { focusField } from "../../lib/focusField";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/cn";
import { actionColorVars, getActionColor, type ActionColorSet } from "../../types";

export type ActionRadioEntry = {
  action: string;
  animals: string[];
  count: number;
  disabled?: boolean;
};

const WIDE_COLUMNS = 520;

export function ActionRadioGrid({
  entries,
  orderedActions,
  selectedAction,
  onSelect,
}: {
  entries: ActionRadioEntry[];
  orderedActions: string[];
  selectedAction: string | null | undefined;
  onSelect: (action: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Array<HTMLElement | null>>([]);
  const [columns, setColumns] = useState(1);
  const enabledIndexes = entries.flatMap((entry, index) =>
    entry.disabled ? [] : [index],
  );
  const selectedIndex = entries.findIndex(
    (entry) => entry.action === selectedAction,
  );
  const tabIndexFor =
    selectedIndex >= 0 ? selectedIndex : (enabledIndexes[0] ?? 0);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const fit = () => setColumns(node.clientWidth >= WIDE_COLUMNS ? 2 : 1);
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    fit();
    return () => observer.disconnect();
  }, []);

  const focusIndex = (index: number) => {
    const button = buttonRefs.current[index];
    focusField(button);
    button?.scrollIntoView({ block: "nearest" });
  };

  const choose = (index: number) => {
    const entry = entries[index];
    if (!entry || entry.disabled) return;
    focusIndex(index);
    if (entry.action !== selectedAction) onSelect(entry.action);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (enabledIndexes.length === 0) return;
    const current = enabledIndexes.includes(selectedIndex)
      ? selectedIndex
      : tabIndexFor;
    const column = ((current % columns) + columns) % columns;
    const step = columns === 1 ? 1 : columns;
    let next = current;
    if (event.key === "ArrowRight") {
      const candidate = columns === 1 ? current + 1 : current + 1;
      const canMove = columns === 1 || column < columns - 1;
      if (
        canMove &&
        candidate < entries.length &&
        !entries[candidate]?.disabled
      )
        next = candidate;
    } else if (event.key === "ArrowLeft") {
      const candidate = current - 1;
      const canMove = columns === 1 || column > 0;
      if (canMove && candidate >= 0 && !entries[candidate]?.disabled)
        next = candidate;
    } else if (event.key === "ArrowDown") {
      const candidate = current + step;
      if (candidate < entries.length && !entries[candidate]?.disabled)
        next = candidate;
    } else if (event.key === "ArrowUp") {
      const candidate = current - step;
      if (candidate >= 0 && !entries[candidate]?.disabled) next = candidate;
    } else if (event.key === "Home") {
      next = enabledIndexes[0];
    } else if (event.key === "End") {
      next = enabledIndexes[enabledIndexes.length - 1];
    } else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      choose(current);
      return;
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (next !== current) choose(next);
    else focusIndex(current);
  };

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label="可选行为"
      data-key-scope="studio-field"
      className="min-h-0 flex-1 overflow-auto px-3 pb-3"
      onKeyDown={onKeyDown}
    >
      {entries.length === 0 ? (
        <p className="px-1 py-3 text-xs text-mute">没有符合筛选的行为</p>
      ) : (
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {entries.map((entry, index) => (
            <ActionRadioCard
              key={entry.action}
              entry={entry}
              color={getActionColor(entry.action, orderedActions)}
              selected={entry.action === selectedAction}
              tabIndex={index === tabIndexFor ? 0 : -1}
              buttonRef={(node) => {
                buttonRefs.current[index] = node;
              }}
              onSelect={() => choose(index)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ActionRadioCard({
  entry,
  color,
  selected,
  tabIndex,
  buttonRef,
  onSelect,
}: {
  entry: ActionRadioEntry;
  color: ActionColorSet;
  selected: boolean;
  tabIndex: number;
  buttonRef: (node: HTMLElement | null) => void;
  onSelect: () => void;
}) {
  const species = entry.animals.join(", ");
  const vars = actionColorVars(color);
  return (
    <div
      ref={buttonRef}
      role="radio"
      aria-checked={selected}
      aria-disabled={entry.disabled || undefined}
      tabIndex={entry.disabled ? -1 : tabIndex}
      onPointerDown={(event) => delete event.currentTarget.dataset.kbd}
      onBlur={(event) => delete event.currentTarget.dataset.kbd}
      onClick={() => {
        if (entry.disabled) return;
        const sel = window.getSelection()?.toString().trim();
        if (sel) return;
        onSelect();
      }}
      style={vars}
      className={cn(
        "group relative flex min-w-0 cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg border px-3 py-2 text-left text-xs",
        "transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.985]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark data-[kbd=true]:ring-2 data-[kbd=true]:ring-mark",
        selected
          ? "action-radio-selected text-ink shadow-sm"
          : "border-line/80 bg-studio/50 hover:-translate-y-[1px] hover:border-mark/35 hover:bg-card/70 hover:shadow-sm",
        entry.disabled && "cursor-not-allowed opacity-45 hover:translate-y-0 hover:bg-studio/50 hover:shadow-none",
      )}
    >
      <span
        className={cn(
          "absolute inset-y-0 left-0 w-1 origin-center transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]",
          selected
            ? "scale-y-100 opacity-100"
            : "scale-y-0 opacity-0 group-hover:scale-y-50 group-hover:opacity-60",
        )}
        style={{ backgroundColor: color.bg }}
        aria-hidden
      />
      <span
        className={cn(
          "h-2.5 w-2.5 shrink-0 rounded-full transition-transform duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]",
          selected ? "scale-110" : "group-hover:scale-110",
        )}
        style={{ backgroundColor: color.bg }}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="selectable-text block break-words text-xs font-semibold text-ink select-text">
          {entry.action}
        </span>
        {species && (
          <span
            className="selectable-text mt-0.5 block truncate text-[10px] leading-4 text-mute select-text"
            title={species}
          >
            {species}
          </span>
        )}
      </span>
      <span
        style={vars}
        className={cn(
          "select-none shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] font-medium transition-colors duration-200",
          entry.count > 0 ? "action-pill" : "bg-card text-mute group-hover:bg-panel",
        )}
      >
        {entry.count > 0 ? `${entry.count} 段` : "0 段"}
      </span>
      <span
        className={cn(
          "action-check-icon select-none flex h-3.5 w-3.5 shrink-0 items-center justify-center transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)]",
          selected ? "w-3.5 scale-100 opacity-100" : "w-0 scale-50 opacity-0",
        )}
        aria-hidden
      >
        <Check size={13} />
      </span>
    </div>
  );
}
