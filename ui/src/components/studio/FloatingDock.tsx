import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { formatTime } from "../../format";

const DockCompactContext = createContext(false);

export function undoShortcut(): string {
  if (typeof navigator === "undefined") return "Ctrl+Z";
  const platform = `${navigator.platform} ${navigator.userAgent}`;
  return /Mac|iPhone|iPad/.test(platform) ? "⌘Z" : "Ctrl+Z";
}

export function redoShortcut(): string {
  if (typeof navigator === "undefined") return "Ctrl+Shift+Z";
  const platform = `${navigator.platform} ${navigator.userAgent}`;
  return /Mac|iPhone|iPad/.test(platform) ? "⌘⇧Z" : "Ctrl+Shift+Z";
}

function cleanStatusText(raw: string): string {
  if (!raw) return "就绪";
  if (raw.startsWith("正在标注卡片：")) {
    return "就绪 · 可按 I / O 或拖拽时间轴划段";
  }
  return raw;
}

export function FloatingDock({
  current,
  duration,
  fps,
  status,
  children,
}: {
  current: number;
  duration: number;
  fps: number;
  status: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const rate = fps > 0 ? fps : 25;
  const frame = String(Math.max(0, Math.round(current * rate))).padStart(
    4,
    "0",
  );
  const total = String(
    Math.max(0, Math.round(Math.max(0, duration) * rate)),
  ).padStart(4, "0");
  const displayStatus = cleanStatusText(status);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const fit = () => setCompact(node.clientWidth < 960);
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    fit();
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="transport shrink-0">
      <div className="transport-meta">
        <div className="transport-timecode">
          <span className="text-xs font-semibold text-ink">
            {formatTime(current)}
          </span>
          <span className="text-[10px] text-mute">/ {formatTime(duration)}</span>
        </div>
        <span className="hidden rounded border border-line/70 bg-studio px-2 py-0.5 font-mono text-[10px] text-mute sm:inline-block">
          F {frame} <span className="text-mute/50">/</span> {total}
        </span>
      </div>

      <DockCompactContext.Provider value={compact}>
        <div
          role="toolbar"
          aria-label="播放与标注"
          data-key-scope="studio-field"
          className="transport-controls"
          onKeyDown={moveToolbarFocus}
        >
          {children}
        </div>
      </DockCompactContext.Provider>

      <span
        className="transport-status hidden sm:block"
        title={status}
        role="status"
      >
        {displayStatus}
      </span>
    </div>
  );
}

function moveToolbarFocus(event: KeyboardEvent<HTMLDivElement>) {
  const key = event.key;
  if (
    key !== "ArrowLeft" &&
    key !== "ArrowRight" &&
    key !== "ArrowUp" &&
    key !== "ArrowDown" &&
    key !== "Home" &&
    key !== "End"
  ) {
    return;
  }
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
      "button:not(:disabled)",
    ),
  ];
  if (buttons.length === 0) return;
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  let next = current < 0 ? 0 : current;
  if (key === "Home") next = 0;
  else if (key === "End") next = buttons.length - 1;
  else if (key === "ArrowRight" || key === "ArrowDown")
    next = Math.min(buttons.length - 1, current < 0 ? 0 : current + 1);
  else next = Math.max(0, current < 0 ? 0 : current - 1);
  event.preventDefault();
  event.stopPropagation();
  buttons[next]?.focus();
}

export function ToolbarGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-xl border border-line/80 bg-panel/95 p-1 shadow-[0_2px_10px_-2px_rgba(15,23,42,0.08)] backdrop-blur-md",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ToolbarDivider() {
  return (
    <span
      className="mx-0.5 h-4 w-[1px] shrink-0 bg-line/80"
      aria-hidden
    />
  );
}

export function ToolbarSeparator() {
  return (
    <span className="hidden h-4 w-px shrink-0 bg-line/70 xl:block" aria-hidden />
  );
}

export function DockButton({
  label,
  shortcut,
  onClick,
  disabled = false,
  keepLabel = false,
  iconOnly = false,
  active = false,
  tone = "idle",
  children,
}: {
  label: string;
  shortcut: string;
  onClick: () => void;
  disabled?: boolean;
  keepLabel?: boolean;
  iconOnly?: boolean;
  active?: boolean;
  tone?: "idle" | "primary" | "good";
  children: ReactNode;
}) {
  const compact = useContext(DockCompactContext);
  const showText = !iconOnly && (keepLabel || !compact);
  return (
    <Hint text={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active || undefined}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          "group relative inline-flex h-7 min-w-[28px] items-center justify-center gap-1.5 rounded-lg px-2 text-[11px] font-medium transition-all duration-150 ease-out",
          "focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark/60 active:scale-[0.94]",
          "disabled:pointer-events-none disabled:opacity-35",
          iconOnly && "w-7 px-0",
          tone === "good"
            ? "bg-mark/10 text-mark font-semibold hover:bg-mark hover:text-white hover:shadow-sm"
            : tone === "primary"
              ? active
                ? "bg-mark text-white shadow-sm hover:brightness-110"
                : "bg-card/90 text-ink font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-line/60 hover:bg-mark hover:text-white hover:ring-mark"
              : active
                ? "bg-card text-ink shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-line/60"
                : "text-mute hover:bg-card/90 hover:text-ink",
        )}
      >
        <span className="inline-flex shrink-0 items-center justify-center transition-transform duration-150 group-hover:scale-105 [&>svg]:h-[15px] [&>svg]:w-[15px] [&>svg]:stroke-[1.8]">
          {children}
        </span>
        {showText ? <span className="whitespace-nowrap">{label}</span> : null}
        {keepLabel && !compact && !iconOnly ? <Kbd>{shortcut}</Kbd> : null}
      </button>
    </Hint>
  );
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-line/80 bg-panel/85 px-1 font-mono text-[9px] font-medium leading-3.5 text-mute">
      {children}
    </kbd>
  );
}

export function Hint({
  text,
  shortcut,
  children,
}: {
  text: string;
  shortcut?: string;
  children: ReactNode;
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<number>(0);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, ready: false });

  const hide = () => {
    window.clearTimeout(timerRef.current);
    setOpen(false);
    setPos((prev) => ({ ...prev, ready: false }));
  };

  const show = () => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(true), 180);
  };

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const tip = tipRef.current.getBoundingClientRect();
    let left = rect.left + rect.width / 2 - tip.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tip.width - 8));
    let top = rect.top - tip.height - 7;
    if (top < 8) top = rect.bottom + 7;
    setPos({ top, left, ready: true });
  }, [open, text, shortcut]);

  return (
    <span
      ref={anchorRef}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {open
        ? createPortal(
            <span
              ref={tipRef}
              role="tooltip"
              className="pointer-events-none fixed z-50 flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-line/80 bg-panel/95 px-2.5 py-1 text-[11px] font-medium text-ink shadow-xl backdrop-blur-md"
              style={{
                top: pos.top,
                left: pos.left,
                visibility: pos.ready ? "visible" : "hidden",
              }}
            >
              <span>{text}</span>
              {shortcut ? <Kbd>{shortcut}</Kbd> : null}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}
