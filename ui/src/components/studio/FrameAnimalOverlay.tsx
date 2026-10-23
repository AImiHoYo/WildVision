import { memo, useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { getActionColor } from "../../types";
import { labelHint } from "../../lib/labelHints";

const OVERLAY_SCALE_STORAGE_KEY = "wildvision.frameOverlayScale";
const BASE_WIDTH = 310;
const BASE_HEIGHT = 220;
const MIN_SCALE = 0.55;
const MAX_SCALE = 2.2;

export type FrameTrackOverlayRow = {
  trackIndex: number;
  animalName: string;
  activeActions: string[];
  actionText: string;
};

function clampScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(value * 100) / 100));
}

function readInitialScale(): number {
  try {
    const raw = localStorage.getItem(OVERLAY_SCALE_STORAGE_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= MIN_SCALE && parsed <= MAX_SCALE) {
        return parsed;
      }
    }
  } catch {
    // ignore storage errors
  }
  return 1;
}

type ResizeDrag = {
  mode: "se" | "e" | "s";
  originX: number;
  originY: number;
  originScale: number;
};

type Props = {
  rows: FrameTrackOverlayRow[];
  availableActions: string[];
  visible: boolean;
  onToggleVisible: (next: boolean) => void;
};

export const FrameAnimalOverlay = memo(function FrameAnimalOverlay({
  rows,
  availableActions,
  visible,
  onToggleVisible,
}: Props) {
  const [scale, setScale] = useState<number>(readInitialScale);
  const [resizing, setResizing] = useState(false);
  const dragRef = useRef<ResizeDrag | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(OVERLAY_SCALE_STORAGE_KEY, String(scale));
    } catch {
      // ignore storage errors
    }
  }, [scale]);

  useEffect(() => {
    if (!resizing) return;
    const onMove = (event: PointerEvent) => {
      const active = dragRef.current;
      if (!active) return;
      event.preventDefault();
      const dx = event.clientX - active.originX;
      const dy = event.clientY - active.originY;
      let delta = 0;
      if (active.mode === "e") {
        delta = dx / BASE_WIDTH;
      } else if (active.mode === "s") {
        delta = dy / BASE_HEIGHT;
      } else {
        delta = (dx / BASE_WIDTH + dy / BASE_HEIGHT) / 2;
      }
      setScale(clampScale(active.originScale + delta));
    };
    const onUp = () => {
      dragRef.current = null;
      setResizing(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [resizing]);

  if (rows.length === 0) return null;

  if (!visible) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onToggleVisible(true);
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          backgroundColor: "rgba(10, 14, 23, 0.85)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
        }}
        className="select-none absolute left-3 top-3 z-20 inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/25 bg-black/85 px-2.5 py-1.5 text-[11px] font-medium text-white shadow-xl ring-1 ring-black/50 backdrop-blur-md transition-colors hover:bg-black/95"
        title="显示左上角动物:行为浮层"
      >
        <Eye size={12} />
        <span>显示动物:行为</span>
      </button>
    );
  }

  const startResize = (
    event: React.PointerEvent<HTMLElement>,
    mode: ResizeDrag["mode"],
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = {
      mode,
      originX: event.clientX,
      originY: event.clientY,
      originScale: scale,
    };
    setResizing(true);
  };

  const resetScale = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setScale(1);
  };

  const scaledWidth = Math.round(BASE_WIDTH * scale);
  const scaledFontPx = +(12 * scale).toFixed(2);
  const iconSize = Math.max(8, Math.round(11 * scale));
  const scalePercent = Math.round(scale * 100);

  return (
    <div
      data-testid="video-frame-animal-action-overlay"
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        width: `${scaledWidth}px`,
        fontSize: `${scaledFontPx}px`,
        backgroundColor: "rgba(10, 14, 23, 0.85)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      className={`selectable-text absolute left-3 top-3 z-20 flex max-h-[calc(100%-24px)] max-w-[calc(100%-24px)] flex-col rounded-lg border bg-black/85 text-white shadow-2xl ring-1 ring-black/50 backdrop-blur-md select-text ${
        resizing ? "border-mark/80 ring-mark/40" : "border-white/25"
      }`}
    >
      {/* Header */}
      <div
        className="select-none flex shrink-0 items-center justify-between border-b border-white/20 font-medium text-white/85"
        style={{
          padding: "0.65em 0.9em 0.5em",
          gap: "0.6em",
          fontSize: "0.92em",
        }}
      >
        <span className="truncate">当前帧物种 : 行为</span>
        <div className="flex shrink-0 items-center" style={{ gap: "0.35em" }}>
          <button
            type="button"
            onClick={resetScale}
            className="cursor-pointer rounded border border-white/15 bg-white/10 font-mono text-white/80 transition-colors hover:bg-white/20 hover:text-white"
            style={{
              padding: "0.1em 0.4em",
              fontSize: "0.82em",
            }}
            title="拖动右下角或边缘可等比缩放浮层与字体，点击恢复 100%"
          >
            {scalePercent}%
          </button>
          <button
            type="button"
            onClick={() => onToggleVisible(false)}
            className="inline-flex cursor-pointer items-center rounded border border-white/15 bg-white/10 text-white/90 transition-colors hover:bg-white/20 hover:text-white"
            style={{
              padding: "0.12em 0.45em",
              gap: "0.3em",
              fontSize: "0.86em",
            }}
            title="隐藏左上角动物:行为浮层"
          >
            <EyeOff size={iconSize} />
            <span>隐藏</span>
          </button>
        </div>
      </div>

      {/* Scrollable Track Rows */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        style={{
          padding: "0.45em 0.85em 0.7em",
        }}
      >
        {rows.map((row) => {
          const hasActive = row.activeActions.length > 0;
          const primaryColor = hasActive
            ? getActionColor(row.activeActions[0], availableActions)
            : null;
          return (
            <div
              key={`${row.animalName}-${row.trackIndex}`}
              className={`flex items-baseline rounded font-mono leading-snug select-text ${
                hasActive
                  ? "bg-white/10 font-semibold text-white"
                  : "text-white/90"
              }`}
              style={{
                padding: "0.18em 0.45em",
                gap: "0.45em",
                fontSize: "1em",
                ...(primaryColor ? { color: primaryColor.darkText } : {}),
              }}
            >
              <span
                className="select-none shrink-0 text-white/65"
                style={{ fontSize: "0.84em" }}
              >
                {row.trackIndex + 1}
              </span>
              <span className="selectable-text min-w-0 flex-1 break-words select-text">
                <span {...labelHint("animal", row.animalName)}>{row.animalName}: </span>
                {hasActive
                  ? row.activeActions.map((act, idx) => {
                      const actColor = getActionColor(act, availableActions);
                      return (
                        <span
                          key={act}
                          {...labelHint("action", act)}
                          style={{
                            color: actColor.darkText,
                          }}
                        >
                          {idx > 0 ? `, ${act}` : act}
                        </span>
                      );
                    })
                  : ""}
              </span>
            </div>
          );
        })}
      </div>

      {/* Right Edge Resize Strip */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="左右拖动等比缩放动物行为浮层"
        title="按住拖动可等比放大/缩小浮层与字体（双击恢复 100%）"
        onPointerDown={(e) => startResize(e, "e")}
        onDoubleClick={resetScale}
        className="select-none absolute bottom-3 right-0 top-0 z-30 w-2 cursor-ew-resize"
      />

      {/* Bottom Edge Resize Strip */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="上下拖动等比缩放动物行为浮层"
        title="按住拖动可等比放大/缩小浮层与字体（双击恢复 100%）"
        onPointerDown={(e) => startResize(e, "s")}
        onDoubleClick={resetScale}
        className="select-none absolute bottom-0 left-0 right-3 z-30 h-2 cursor-ns-resize"
      />

      {/* Bottom-Right Corner Proportional Resize Handle */}
      <div
        role="slider"
        aria-label="拖动等比缩放当前帧动物行为浮层与字体"
        aria-valuemin={55}
        aria-valuemax={220}
        aria-valuenow={scalePercent}
        tabIndex={0}
        title="按住右下角拖动可等比放大/缩小浮层与字体（双击恢复 100%）"
        onPointerDown={(e) => startResize(e, "se")}
        onDoubleClick={resetScale}
        onKeyDown={(e) => {
          if (e.key === "+" || e.key === "=" || e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            setScale((prev) => clampScale(prev + 0.1));
          } else if (e.key === "-" || e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            setScale((prev) => clampScale(prev - 0.1));
          } else if (e.key === "0") {
            e.preventDefault();
            setScale(1);
          }
        }}
        className="select-none group absolute bottom-0 right-0 z-40 flex h-4 w-4 cursor-nwse-resize items-end justify-end rounded-br-lg p-0.5 text-white/55 transition-colors hover:text-white"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          aria-hidden="true"
          className="pointer-events-none"
        >
          <path
            d="M9 1L1 9M9 5L5 9M9 8.5L8.5 9"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
});
