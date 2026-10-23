import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatTime } from "../../format";
import { SegmentedControl } from "../ui/SegmentedControl";
import { labelHint, labelHints } from "../../lib/labelHints";
import { buildPairTracks, pairSegments } from "../../lib/pairTracks";
import {
  actionColorVars,
  getActionColor,
  type CompareRow,
  type LabelItem,
  type SegmentItem,
} from "../../types";

const GUTTER = 236;

type Interval = { start: number; end: number; iou: number };
type Drag = {
  id: string;
  mode: "start" | "end";
  originStart: number;
  originEnd: number;
  originX: number;
};

type CreateDrag = {
  rowKey: string;
  trackIndex: number;
  animal: string;
  action: string;
  anchorTime: number;
  currentTime: number;
  originX: number;
  moved: boolean;
};

type Props = {
  listAnimal?: string[];
  availableActions?: string[];
  labels: LabelItem[];
  segments: SegmentItem[];
  comparisons: CompareRow[];
  grounding?: Interval[];
  current: number;
  duration: number;
  selectedKey: string | null;
  selectedTrackIndex?: number;
  selectedAction?: string | null;
  pendingKey: string | null;
  pendingTrackIndex?: number | null;
  pendingAction?: string | null;
  pendingTime: number | null;
  activeId: string | null;
  selectedIds?: string[];
  doneCount: number;
  labelCount: number;
  onSeek: (time: number, play?: boolean) => void;
  onSelectLabel?: (animal: string, action: string) => void;
  onSelectSegment: (id: string, multi?: boolean) => void;
  onUpdateSegment: (id: string, start: number, end: number) => void;
  onChangeSegmentAction?: (id: string, action: string) => void;
  onDeselectSegment?: () => void;
  onDeleteSegment?: (id: string) => void;
  onCopySegments?: () => void;
  onPasteSegments?: () => void;
  canPaste?: boolean;
  fps?: number;
  onCreateSegment?: (
    animal: string,
    action: string,
    start: number,
    end: number,
    trackIndex: number,
  ) => void;
};

function shift(
  originStart: number,
  originEnd: number,
  mode: Drag["mode"],
  delta: number,
) {
  let start = originStart;
  let end = originEnd;
  if (mode === "start") {
    start = Math.min(originEnd - 0.04, Math.max(0, originStart + delta));
  } else {
    end = Math.max(originStart + 0.04, originEnd + delta);
  }
  return { start, end };
}

export function Timeline({
  listAnimal = [],
  availableActions = [],
  labels,
  segments,
  comparisons,
  grounding = [],
  current,
  duration,
  selectedTrackIndex = 0,
  selectedAction = null,
  pendingTrackIndex = null,
  pendingAction = null,
  pendingTime,
  activeId,
  selectedIds = [],
  doneCount,
  labelCount,
  onSeek,
  onSelectLabel,
  onSelectSegment,
  onUpdateSegment,
  onChangeSegmentAction,
  onCreateSegment,
  onDeselectSegment,
  onDeleteSegment,
  onCopySegments,
  onPasteSegments,
  canPaste = false,
  fps = 25,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<"1" | "2" | "4">("1");
  const zoomNum = Number(zoom) as 1 | 2 | 4;
  const [scrubbing, setScrubbing] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [createDrag, setCreateDrag] = useState<CreateDrag | null>(null);
  const [preview, setPreview] = useState<{
    id: string;
    start: number;
    end: number;
  } | null>(null);
  const [press, setPress] = useState<{
    id: string;
    x: number;
    y: number;
    shiftKey: boolean;
  } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(
    null,
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const menuSegment = menu ? segments.find((item) => item.id === menu.id) : undefined;
  const menuActions = [...new Set(labels.filter((item) => item.animal === menuSegment?.animal).map((item) => item.action))];
  useLayoutEffect(() => {
    const node = menuRef.current;
    if (!menu || !node) return;
    const bounds = node.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8))}px`;
  }, [menu]);

  const animalTracks = useMemo(
    () => buildPairTracks(labels, listAnimal, segments),
    [listAnimal, labels, segments],
  );

  const orderedActions = useMemo(() => {
    if (availableActions && availableActions.length > 0) {
      return availableActions;
    }
    const seen: string[] = [];
    for (const item of labels) {
      if (!seen.includes(item.action)) {
        seen.push(item.action);
      }
    }
    return seen;
  }, [availableActions, labels]);

  const activeAction = selectedAction || orderedActions[0] || "";

  const span = Math.max(duration, 1);
  const showCompare = comparisons.length > 0;
  const laneHeight = showCompare ? 62 : 50;
  const aiLane = grounding.length > 0 ? 36 : 0;

  function timeAt(clientX: number): number {
    const bounds = contentRef.current?.getBoundingClientRect();
    if (!bounds) return 0;
    const width = Math.max(1, bounds.width - GUTTER);
    const x = clientX - bounds.left - GUTTER;
    return Math.max(0, Math.min(span, (x / width) * span));
  }

  const onSeekRef = useRef(onSeek);
  onSeekRef.current = onSeek;
  const timeAtRef = useRef(timeAt);
  timeAtRef.current = timeAt;

  useEffect(() => {
    if (!scrubbing) return;
    const onMove = (event: PointerEvent) => {
      event.preventDefault();
      onSeekRef.current(timeAtRef.current(event.clientX), false);
    };
    const onUp = () => setScrubbing(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [scrubbing]);

  useEffect(() => {
    if (!drag) return;
    const widthOf = () =>
      Math.max(
        1,
        (contentRef.current?.getBoundingClientRect().width || 1) - GUTTER,
      );
    const move = (event: PointerEvent) => {
      const delta = ((event.clientX - drag.originX) / widthOf()) * span;
      setPreview({
        id: drag.id,
        ...shift(drag.originStart, drag.originEnd, drag.mode, delta),
      });
    };
    const up = (event: PointerEvent) => {
      if (Math.abs(event.clientX - drag.originX) > 2) {
        const delta = ((event.clientX - drag.originX) / widthOf()) * span;
        const next = shift(drag.originStart, drag.originEnd, drag.mode, delta);
        onUpdateSegment(drag.id, next.start, next.end);
      }
      setDrag(null);
      setPreview(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, onUpdateSegment, span]);

  const selectedIdSet = useMemo(
    () => new Set(selectedIds.length > 0 ? selectedIds : activeId ? [activeId] : []),
    [selectedIds, activeId],
  );

  useEffect(() => {
    if (!press) return;
    const up = (event: PointerEvent) => {
      const moved = Math.hypot(
        event.clientX - press.x,
        event.clientY - press.y,
      );
      if (moved < 3) {
        if (press.shiftKey) {
          onSelectSegment(press.id, true);
        } else if (selectedIdSet.size === 1 && selectedIdSet.has(press.id)) {
          onDeselectSegment?.();
        } else {
          onSelectSegment(press.id, false);
        }
      }
      setPress(null);
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [press, selectedIdSet, onDeselectSegment, onSelectSegment]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const onCreateSegmentRef = useRef(onCreateSegment);
  onCreateSegmentRef.current = onCreateSegment;
  const createDragRef = useRef<CreateDrag | null>(null);
  createDragRef.current = createDrag;

  const isCreatingDrag = Boolean(createDrag);

  useEffect(() => {
    if (!isCreatingDrag) return;
    const move = (event: PointerEvent) => {
      const active = createDragRef.current;
      if (!active) return;
      const t = timeAtRef.current(event.clientX);
      const moved =
        active.moved || Math.abs(event.clientX - active.originX) >= 6;
      const next: CreateDrag = { ...active, currentTime: t, moved };
      createDragRef.current = next;
      setCreateDrag(next);
      onSeekRef.current(t, false);
    };
    const up = (event: PointerEvent) => {
      const active = createDragRef.current;
      createDragRef.current = null;
      setCreateDrag(null);
      if (!active) return;
      const endT = timeAtRef.current(event.clientX);
      const start = Math.min(active.anchorTime, endT);
      const end = Math.max(active.anchorTime, endT);
      const moved =
        active.moved || Math.abs(event.clientX - active.originX) >= 6;
      if (
        moved &&
        end - start >= 0.08 &&
        active.action &&
        onCreateSegmentRef.current
      ) {
        onCreateSegmentRef.current(
          active.animal,
          active.action,
          start,
          end,
          active.trackIndex,
        );
      }
    };
    const cancel = () => {
      createDragRef.current = null;
      setCreateDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
    };
  }, [isCreatingDrag]);

  const leftOf = (time: number) => `${(time / span) * 100}%`;
  const widthOfBar = (start: number, end: number) =>
    `${Math.max(0.5, ((end - start) / span) * 100)}%`;
  const activeActionColor = getActionColor(activeAction, orderedActions);

  return (
    <section
      className="studio-surface flex h-full min-h-0 flex-col bg-panel"
      aria-label="动物与行为组合时间轴"
    >
      {/* Compact Timeline Header Bar */}
      <div className="flex h-[36px] min-h-[36px] max-h-[36px] shrink-0 flex-nowrap items-center justify-between gap-2 overflow-hidden border-b border-line px-3.5 text-xs text-mute">
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2.5 overflow-hidden">
          <span
            className="select-none text-xs font-semibold text-ink"
            title={`覆盖 ${doneCount}/${labelCount} 类行为`}
          >
            时间轴
          </span>
          <span className="select-none font-mono text-[11px] text-mute">
            {animalTracks.length} 组合轨道 · {segments.length} 段
          </span>
          {selectedIdSet.size > 1 && (
            <span className="select-none rounded bg-mark/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-mark">
              已多选 {selectedIdSet.size} 段
            </span>
          )}
          {activeAction && (
            <span
              className="action-pill selectable-text inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium transition-all duration-200 select-text"
              style={actionColorVars(activeActionColor)}
              {...labelHint("action", activeAction)}
            >
              <span
                className="select-none h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: activeActionColor.bg }}
              />
              <span className="selectable-text select-text">当前行为：{activeAction}</span>
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <SegmentedControl
            label="时间轴缩放"
            fullWidth={false}
            size="xs"
            value={zoom}
            onChange={setZoom}
            options={[
              { id: "1", label: "1x" },
              { id: "2", label: "2x" },
              { id: "4", label: "4x" },
            ]}
          />
          <span className="font-mono text-xs font-semibold text-ink">
            {formatTime(current)}
          </span>
        </div>
      </div>

      {/* Full-Bleed NLE Track Canvas */}
      <div
        className="min-h-0 flex-1 overflow-auto bg-studio"
        onScroll={() => setMenu(null)}
      >
        <div
          ref={contentRef}
          style={{ width: `${zoomNum * 100}%`, minWidth: "100%" }}
        >
          <div
            className="relative"
            style={{
              height:
                28 + Math.max(1, animalTracks.length) * laneHeight + aiLane,
            }}
          >
            {/* Top Ruler Header */}
            <div
              className="absolute left-0 top-0 z-10 flex items-center justify-between border-b border-r border-line bg-panel px-3 text-[10px] font-medium uppercase tracking-wider text-mute"
              style={{ width: GUTTER, height: 28 }}
            >
              <span>动物 · 行为</span>
              <span className="font-mono text-[9px] text-mute/60">TRACK</span>
            </div>
            <div
              data-seek="track"
              className="select-none absolute right-0 top-0 z-10 cursor-ew-resize border-b border-line bg-panel/95"
              style={{ left: GUTTER, height: 28 }}
              onPointerDown={(event) => {
                event.preventDefault();
                onSeek(timeAt(event.clientX), false);
                setScrubbing(true);
              }}
            >
              {[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((tick) => (
                <span
                  key={tick}
                  className="pointer-events-none absolute bottom-0 w-px bg-line"
                  style={{
                    left: `${tick * 100}%`,
                    height: Math.round(tick * 10) % 2 === 0 ? 7 : 4,
                  }}
                />
              ))}
              {[0, 0.2, 0.4, 0.6, 0.8].map((mark) => (
                <span
                  key={mark}
                  className={`pointer-events-none absolute top-1.5 font-mono text-[10px] text-mute ${
                    mark === 0 ? "left-3.5" : "-translate-x-1/2"
                  }`}
                  style={mark === 0 ? undefined : { left: `${mark * 100}%` }}
                >
                  {mark === 0 ? "00:00.0" : formatTime(span * mark)}
                </span>
              ))}
            </div>

            {/* Playhead Line & Precision Cap */}
            <div
              className="pointer-events-none absolute bottom-0 top-0 z-30 w-[1.5px] bg-mark"
              style={{
                left: `calc(${GUTTER}px + (100% - ${GUTTER}px) * ${Math.min(1, Math.max(0, current / span))})`,
              }}
            >
              <div
                className="pointer-events-auto -ml-[4.5px] top-0 h-3 w-[10px] cursor-ew-resize rounded-b-sm bg-mark shadow-md ring-1 ring-white/30 transition-transform duration-150 hover:scale-110"
                title="按住左右拖动时间轴游标"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  setScrubbing(true);
                }}
              />
            </div>

            {/* Animal Track Rows */}
            {animalTracks.map((track, trackIndex) => {
              const animalName = track.animal;
              const actionName = track.action;
              const mine = pairSegments(segments, animalName, actionName);
              const rows = comparisons.filter(
                (row) => row.label[0] === animalName && row.label[1] === actionName,
              );
              const isSelected = listAnimal[selectedTrackIndex] === animalName && activeAction === actionName;
              const isPendingTrack =
                listAnimal[pendingTrackIndex ?? selectedTrackIndex] === animalName &&
                (pendingAction || activeAction) === actionName &&
                pendingTime !== null;
              const allowed = pendingTime === null || isPendingTrack;
              const rowColor = getActionColor(actionName, orderedActions);
              const pendingColor = getActionColor(
                pendingAction || activeAction,
                orderedActions,
              );

              return (
                <div
                  key={track.key}
                  className={`absolute left-0 right-0 border-b border-line/70 ${
                    allowed
                      ? ""
                      : "cursor-not-allowed bg-card/30 text-mute/40 opacity-50"
                  }`}
                  style={{
                    top: 28 + trackIndex * laneHeight,
                    height: laneHeight,
                  }}
                >
                  <div
                    role="button"
                    tabIndex={allowed ? 0 : -1}
                    aria-disabled={!allowed || undefined}
                    {...labelHints([{ kind: "animal", label: animalName }, { kind: "action", label: actionName }])}
                    aria-label={`${animalName} — ${actionName}`}
                    onClick={() => {
                      if (!allowed) return;
                      const sel = window.getSelection()?.toString().trim();
                      if (sel) return;
                      onSelectLabel?.(animalName, actionName);
                    }}
                    onKeyDown={(e) => {
                      if (!allowed) return;
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectLabel?.(animalName, actionName);
                      }
                    }}
                    className={`group absolute inset-y-0 left-0 z-10 flex cursor-pointer flex-col justify-center border-r border-line px-3 text-left text-xs transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                      !allowed
                        ? "cursor-not-allowed bg-panel/40 text-mute/40"
                        : isSelected
                          ? "bg-selection text-ink"
                          : "bg-panel text-ink hover:bg-card/75"
                    }`}
                    style={{ width: GUTTER }}
                  >
                    <span
                      className={`select-none absolute inset-y-0 left-0 w-[3px] origin-center bg-mark transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                        isSelected && allowed
                          ? "scale-y-100 opacity-100"
                          : "scale-y-0 opacity-0 group-hover:scale-y-50 group-hover:opacity-50"
                      }`}
                      aria-hidden
                    />
                    <div className="flex items-center justify-between gap-1.5 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:translate-x-0.5">
                      <span
                        className="selectable-text truncate text-xs font-semibold select-text"
                      >
                        {animalName}
                      </span>
                      <span
                        className={`select-none shrink-0 rounded px-1.5 py-0.2 font-mono text-[10px] font-medium transition-all duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] ${
                          isSelected
                            ? "bg-mark text-white shadow-sm"
                            : "bg-card text-mute group-hover:bg-panel group-hover:text-ink"
                        }`}
                      >
                        #{trackIndex + 1}
                      </span>
                    </div>
                    <div className="selectable-text mt-0.5 truncate text-[10px] font-medium select-text" style={{ color: rowColor.bg }} {...labelHint("action", actionName)}>
                      {actionName}
                      <span className="ml-2 text-mute">{mine.length} 段</span>
                    </div>
                    <div className="sr-only">
                      {!allowed
                        ? "请先结束或取消当前起点"
                        : mine.length > 0
                          ? `已标 ${mine.length} 段 (${Array.from(new Set(mine.map((m) => m.action))).join(", ")})`
                          : isSelected
                            ? "当前选中轨道"
                            : "0 段区间"}
                    </div>
                  </div>

                  <div
                    className={`select-none absolute inset-y-0 right-0 transition-colors duration-250 ${
                      !allowed
                        ? "pointer-events-none cursor-not-allowed"
                        : pendingTime !== null && isSelected
                          ? "cursor-ew-resize"
                          : "cursor-crosshair"
                    } ${
                      isSelected && allowed
                        ? "bg-mark/[0.04]"
                        : trackIndex % 2 === 1
                          ? "bg-card/20"
                          : ""
                    }`}
                    style={{ left: GUTTER }}
                    onPointerMove={(event) => {
                      if (!allowed || pendingTime === null || !isSelected)
                        return;
                      onSeek(timeAt(event.clientX), false);
                    }}
                    onPointerDown={(event) => {
                      if (!allowed || event.button !== 0) return;
                      onSelectLabel?.(animalName, actionName);
                      const t = timeAt(event.clientX);
                      onSeek(t, false);
                      if (pendingTime !== null) {
                        setScrubbing(true);
                        return;
                      }
                      setCreateDrag({
                        rowKey: track.key,
                        trackIndex: track.sourceTrackIndex,
                        animal: animalName,
                        action: actionName,
                        anchorTime: t,
                        currentTime: t,
                        originX: event.clientX,
                        moved: false,
                      });
                    }}
                  >
                    {[0.2, 0.4, 0.6, 0.8].map((gridTick) => (
                      <span
                        key={gridTick}
                        className="pointer-events-none absolute inset-y-0 w-px bg-line/40"
                        style={{ left: `${gridTick * 100}%` }}
                      />
                    ))}

                    {createDrag &&
                      createDrag.rowKey === track.key &&
                      createDrag.moved && (
                        <div
                          className="action-pill pointer-events-none absolute top-2 z-20 h-7 rounded px-1.5 font-mono text-[10px] font-semibold leading-7 shadow-sm"
                          style={{
                            ...actionColorVars(rowColor),
                            left: leftOf(
                              Math.min(
                                createDrag.anchorTime,
                                createDrag.currentTime,
                              ),
                            ),
                            width: widthOfBar(
                              Math.min(
                                createDrag.anchorTime,
                                createDrag.currentTime,
                              ),
                              Math.max(
                                createDrag.anchorTime,
                                createDrag.currentTime,
                              ),
                            ),
                            border: `1.5px solid ${rowColor.bg}`,
                          }}
                        >
                          [{createDrag.action}]{" "}
                          {formatTime(
                            Math.min(
                              createDrag.anchorTime,
                              createDrag.currentTime,
                            ),
                          )}{" "}
                          –{" "}
                          {formatTime(
                            Math.max(
                              createDrag.anchorTime,
                              createDrag.currentTime,
                            ),
                          )}
                        </div>
                      )}

                    {mine.map((segment) => {
                      const shown =
                        preview?.id === segment.id ? preview : segment;
                      const selected = selectedIdSet.has(segment.id);
                      const color = getActionColor(
                        segment.action,
                        orderedActions,
                      );
                      return (
                        <button
                          key={segment.id}
                          type="button"
                          {...labelHints([{ kind: "animal", label: animalName }, { kind: "action", label: segment.action }])}
                          data-label-detail={`#${trackIndex + 1} · ${formatTime(shown.start)} – ${formatTime(shown.end)}（Shift+左键可多选）`}
                          className={`absolute top-2 z-10 h-7 overflow-hidden rounded border px-2 text-left text-[10px] font-semibold leading-7 text-white shadow-sm transition-[filter,box-shadow] duration-150 ${
                            selected
                              ? "cursor-ew-resize ring-2 ring-mark ring-offset-1 ring-offset-studio"
                              : "cursor-pointer hover:brightness-110"
                          }`}
                          style={{
                            left: leftOf(shown.start),
                            width: widthOfBar(shown.start, shown.end),
                            backgroundColor: color.bg,
                            borderColor: color.border,
                          }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            if (!selectedIdSet.has(segment.id)) {
                              onSelectSegment(segment.id, false);
                            }
                            setMenu({
                              x: event.clientX,
                              y: event.clientY,
                              id: segment.id,
                            });
                          }}
                          onPointerDown={(event) => {
                            if (event.button !== 0) return;
                            event.stopPropagation();
                            const bounds =
                              event.currentTarget.getBoundingClientRect();
                            const edge =
                              event.clientX - bounds.left < 8
                                ? "start"
                                : bounds.right - event.clientX < 8
                                  ? "end"
                                  : null;
                            if (selected && edge && !event.shiftKey) {
                              setDrag({
                                id: segment.id,
                                mode: edge,
                                originStart: segment.start,
                                originEnd: segment.end,
                                originX: event.clientX,
                              });
                              return;
                            }
                            setPress({
                              id: segment.id,
                              x: event.clientX,
                              y: event.clientY,
                              shiftKey: event.shiftKey,
                            });
                          }}
                        >
                          {selected && (
                            <>
                              <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-white/90" />
                              <span className="pointer-events-none absolute inset-y-0 right-0 w-0.5 bg-white/90" />
                            </>
                          )}
                          <span className="pointer-events-none truncate font-mono">
                            {segment.action} · {formatTime(shown.start)}–
                            {formatTime(shown.end)}
                          </span>
                        </button>
                      );
                    })}

                    {showCompare &&
                      rows.map((row, rowIndex) =>
                        row.annotator_b ? (
                          <div
                            key={`${row.label.join("-")}-${rowIndex}`}
                            className="absolute h-3.5 rounded opacity-85"
                            style={{
                              top: 34,
                              left: leftOf(row.annotator_b.start),
                              width: widthOfBar(
                                row.annotator_b.start,
                                row.annotator_b.end,
                              ),
                              background:
                                row.status === "NEEDS_ARBITRATION"
                                  ? "#D97706"
                                  : "#4F46E5",
                            }}
                            title={`对比标注 B (${row.label[1]}): ${formatTime(row.annotator_b.start)} – ${formatTime(row.annotator_b.end)} · tIoU ${row.temporal_iou.toFixed(3)}`}
                          />
                        ) : null,
                      )}

                    {isPendingTrack && pendingTime !== null && (
                      <div
                        className="pointer-events-none absolute top-2 z-10 h-5 rounded opacity-35"
                        style={{
                          left: leftOf(Math.min(pendingTime, current)),
                          width: widthOfBar(
                            Math.min(pendingTime, current),
                            Math.max(pendingTime, current),
                          ),
                          backgroundColor: pendingColor.bg,
                        }}
                      />
                    )}
                    {isPendingTrack && pendingTime !== null && (
                      <div
                        className="pointer-events-none absolute top-0 z-20 h-full w-0.5"
                        style={{
                          left: leftOf(pendingTime),
                          backgroundColor: pendingColor.bg,
                        }}
                      >
                        <span
                          className="action-pill absolute left-1 top-1 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold"
                          style={actionColorVars(pendingColor)}
                        >
                          [{pendingAction || activeAction}] 起点{" "}
                          {formatTime(pendingTime)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {grounding.length > 0 && (
              <div
                className="absolute left-0 right-0"
                style={{
                  top: 28 + Math.max(1, animalTracks.length) * laneHeight,
                  height: 36,
                }}
              >
                <div
                  className="absolute inset-y-0 left-0 border-r border-t border-line bg-panel px-3 py-2 text-xs font-medium text-predict"
                  style={{ width: GUTTER }}
                >
                  AI 语言定位轨
                </div>
                <div
                  className="absolute inset-y-0 right-0 border-t border-line"
                  style={{ left: GUTTER }}
                >
                  {grounding.map((interval, index) => (
                    <button
                      key={index}
                      type="button"
                      className="absolute top-1.5 h-6 truncate rounded bg-predict px-2 text-left font-mono text-[10px] font-semibold text-white shadow-sm"
                      style={{
                        left: leftOf(interval.start),
                        width: widthOfBar(interval.start, interval.end),
                      }}
                      onClick={() => onSeek(interval.start, false)}
                    >
                      AI {formatTime(interval.start)}–{formatTime(interval.end)}{" "}
                      · IoU {interval.iou.toFixed(2)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {animalTracks.length === 0 && (
              <div
                className="absolute text-xs text-mute"
                style={{ left: GUTTER + 16, top: 36 }}
              >
                载入预处理 JSON 后，将自动按动物清单生成多条时间轴轨道。
              </div>
            )}
          </div>
        </div>
      </div>

      {menu && (
        <div
          ref={menuRef}
          data-key-scope="studio-field"
          className="fixed z-50 w-64 max-h-[calc(100vh-16px)] max-w-[calc(100vw-16px)] overflow-auto rounded-lg border border-line bg-panel p-1 text-xs shadow-xl"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {onChangeSegmentAction && menuSegment && (
            <label className="mb-1 block border-b border-line px-2.5 pb-2 pt-1.5 text-ink">
              <span className="mb-1.5 block font-medium">更换该段行为</span>
              <select aria-label="更换该段行为" value={menuSegment.action}
                className="w-full rounded border border-line bg-panel px-2 py-1.5 text-xs text-ink"
                onChange={(event) => {
                  onChangeSegmentAction(menu.id, event.target.value);
                  setMenu(null);
                }}>
                {menuActions.map((action) => <option key={action} value={action}>{action}</option>)}
              </select>
            </label>
          )}
          {onCopySegments && (
            <button
              type="button"
              className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-ink transition-colors hover:bg-card"
              onClick={() => {
                onCopySegments();
                setMenu(null);
              }}
            >
              <span>
                {selectedIdSet.size > 1
                  ? `复制选中的 ${selectedIdSet.size} 段标注`
                  : "复制该段标注"}
              </span>
              <span className="font-mono text-[10px] text-mute">Ctrl+C</span>
            </button>
          )}
          {onPasteSegments && canPaste && (
            <button
              type="button"
              className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-ink transition-colors hover:bg-card"
              onClick={() => {
                onPasteSegments();
                setMenu(null);
              }}
            >
              <span>粘贴标注</span>
              <span className="font-mono text-[10px] text-mute">Ctrl+V</span>
            </button>
          )}
          <button
            type="button"
            className="flex w-full items-center justify-between rounded px-2.5 py-1.5 text-left text-ink transition-colors hover:bg-card"
            onClick={() => {
              onDeleteSegment?.(menu.id);
              setMenu(null);
            }}
          >
            <span>
              {selectedIdSet.size > 1
                ? `删除选中的 ${selectedIdSet.size} 段标注`
                : "删除该段标注"}
            </span>
            <span className="font-mono text-[10px] text-mute">Del</span>
          </button>
          <button
            type="button"
            className="block w-full rounded px-2.5 py-1.5 text-left text-ink transition-colors hover:bg-card"
            onClick={() => {
              const segment = segments.find((item) => item.id === menu.id);
              if (segment) {
                const rate = fps > 0 ? fps : 25;
                onSeek(Math.max(segment.start, segment.end - 1 / rate), false);
              }
              setMenu(null);
            }}
          >
            跳转至标注的最后一帧
          </button>
        </div>
      )}
    </section>
  );
}
