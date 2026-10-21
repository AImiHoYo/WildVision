import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

export const STUDIO_LAYOUT_KEY = "wildvision.studioLayout";

export type StudioLayout = {
  sideWidth: number;
  stackedHeight: number;
  stackedInspectorWidth: number;
  timelineHeight: number;
  inspectorHeight: number;
};

export const DEFAULT_STUDIO_LAYOUT: StudioLayout = {
  sideWidth: 360,
  stackedHeight: 260,
  stackedInspectorWidth: 320,
  timelineHeight: 224,
  inspectorHeight: 260,
};

export function readStudioLayout(): StudioLayout {
  try {
    const raw = localStorage.getItem(STUDIO_LAYOUT_KEY);
    if (!raw) return { ...DEFAULT_STUDIO_LAYOUT };
    const parsed = JSON.parse(raw) as Partial<StudioLayout>;
    const num = (value: unknown, fallback: number) =>
      typeof value === "number" && Number.isFinite(value) ? value : fallback;
    return {
      sideWidth: num(parsed.sideWidth, DEFAULT_STUDIO_LAYOUT.sideWidth),
      stackedHeight: num(
        parsed.stackedHeight,
        DEFAULT_STUDIO_LAYOUT.stackedHeight,
      ),
      stackedInspectorWidth: num(
        parsed.stackedInspectorWidth,
        DEFAULT_STUDIO_LAYOUT.stackedInspectorWidth,
      ),
      timelineHeight: num(
        parsed.timelineHeight,
        DEFAULT_STUDIO_LAYOUT.timelineHeight,
      ),
      inspectorHeight: num(
        parsed.inspectorHeight,
        DEFAULT_STUDIO_LAYOUT.inspectorHeight,
      ),
    };
  } catch {
    return { ...DEFAULT_STUDIO_LAYOUT };
  }
}

type SplitPaneProps = {
  direction: "row" | "column";
  size: number;
  minPrimary: number;
  minSecondary: number;
  onSizeChange: (size: number) => void;
  start: ReactNode;
  end: ReactNode;
  className?: string;
};

export function SplitPane({
  direction,
  size,
  minPrimary,
  minSecondary,
  onSizeChange,
  start,
  end,
  className = "",
}: SplitPaneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [hover, setHover] = useState(false);
  const [fitted, setFitted] = useState(size);
  const [limit, setLimit] = useState(minPrimary);
  const horizontal = direction === "row";

  const clamp = (next: number, available: number) => {
    if (available <= 0) return next;
    const max = Math.max(0, available - minSecondary);
    const min = Math.min(minPrimary, max);
    return Math.min(max, Math.max(min, next));
  };

  const availableSize = () => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const span = horizontal ? rect.width : rect.height;
    return Math.max(0, span - 8);
  };

  const apply = (next: number) => {
    const clamped = clamp(next, availableSize());
    setFitted(clamped);
    if (Math.abs(clamped - size) > 0.5) onSizeChange(clamped);
  };

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const fit = () => {
      const rect = node.getBoundingClientRect();
      const span = (horizontal ? rect.width : rect.height) - 8;
      const available = Math.max(0, span);
      const next = available > 0 ? clamp(size, available) : size;
      const max =
        available > 0 ? Math.max(0, available - minSecondary) : minPrimary;
      setFitted(next);
      setLimit(Math.round(max));
    };
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    fit();
    return () => observer.disconnect();
  }, [horizontal, minPrimary, minSecondary, size]);

  useEffect(() => {
    if (!dragging) return;
    const previousUserSelect = document.body.style.userSelect;
    const previousCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = horizontal ? "col-resize" : "row-resize";
    return () => {
      document.body.style.userSelect = previousUserSelect;
      document.body.style.cursor = previousCursor;
    };
  }, [dragging, horizontal]);

  const sizeFromPointer = (client: number) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return size;
    if (horizontal) return rect.right - client - 4;
    return rect.bottom - client - 4;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that cannot be captured still updates from later move events.
    }
    draggingRef.current = true;
    setDragging(true);
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    apply(sizeFromPointer(horizontal ? event.clientX : event.clientY));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    draggingRef.current = false;
    setDragging(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const grow = event.key === (horizontal ? "ArrowLeft" : "ArrowUp");
    const shrink = event.key === (horizontal ? "ArrowRight" : "ArrowDown");
    if (!grow && !shrink) return;
    event.preventDefault();
    event.stopPropagation();
    apply(fitted + (grow ? 16 : -16));
  };

  const fixedStyle = horizontal
    ? { width: fitted, flex: "0 0 auto" as const }
    : { height: fitted, flex: "0 0 auto" as const };
  const flexStyle = { flex: "1 1 0%", minWidth: 0, minHeight: 0 };

  return (
    <div
      ref={rootRef}
      className={`flex min-h-0 min-w-0 ${horizontal ? "flex-row" : "flex-col"} ${className}`}
    >
      <div
        className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        style={flexStyle}
      >
        {start}
      </div>
      <div
        role="separator"
        aria-orientation={horizontal ? "vertical" : "horizontal"}
        aria-valuenow={Math.round(fitted)}
        aria-valuemin={Math.min(minPrimary, limit)}
        aria-valuemax={limit}
        tabIndex={0}
        aria-label={horizontal ? "调整左右面板宽度" : "调整上下区域高度"}
        data-key-scope="studio-field"
        className={`split-handle relative z-20 shrink-0 touch-none focus-visible:outline-none ${
          horizontal ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        <div
          className={`pointer-events-none absolute ${
            horizontal
              ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
              : "inset-x-0 top-1/2 h-px -translate-y-1/2"
          } ${dragging || hover ? "bg-mark" : "bg-transparent"}`}
        />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden" style={fixedStyle}>
        {end}
      </div>
    </div>
  );
}
