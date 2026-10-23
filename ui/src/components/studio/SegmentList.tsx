import { memo, useMemo, useState, type KeyboardEvent } from "react";
import { ListVideo, LocateFixed, Trash2 } from "lucide-react";
import { frameIndex } from "../../format";
import { labelHint, labelHints } from "../../lib/labelHints";
import { actionColorVars, getActionColor, type SegmentItem } from "../../types";

type Props = {
  segments: SegmentItem[];
  orderedActions: string[];
  fps: number;
  activeId: string | null;
  selectedIds?: string[];
  onSeek: (time: number) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, start: number, end: number) => void;
  onSelect: (id: string, multi?: boolean) => void;
};

export const SegmentList = memo(function SegmentList({
  segments,
  orderedActions,
  fps,
  activeId,
  selectedIds = [],
  onSeek,
  onDelete,
  onUpdate,
  onSelect,
}: Props) {
  const selectedSet = useMemo(
    () =>
      new Set(
        selectedIds.length > 0 ? selectedIds : activeId ? [activeId] : [],
      ),
    [selectedIds, activeId],
  );
  return (
    <section
      className="flex h-full min-h-0 flex-col border-t border-line"
      aria-labelledby="segments-heading"
    >
      <div className="panel-heading">
        <div className="flex items-center gap-2">
          <h2 id="segments-heading">
            <ListVideo size={14} aria-hidden />
            已标区间
          </h2>
          {selectedSet.size > 1 && (
            <span className="rounded bg-mark/15 px-1.5 py-0.5 font-mono text-[10px] font-medium text-mark">
              已选 {selectedSet.size} 段
            </span>
          )}
        </div>
        <span className="panel-count">{segments.length}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-3 pt-2.5">
        {segments.length === 0 ? (
          <div className="grid h-full min-h-[96px] place-content-center rounded-md border border-dashed border-line/80 bg-studio/40 px-4 py-5 text-center">
            <ListVideo
              size={18}
              className="mx-auto mb-1.5 text-mute/70"
              aria-hidden
            />
            <p className="text-xs font-medium text-ink">暂无标注区间</p>
            <p className="mt-1 text-[11px] leading-4 text-mute">
              在时间轴拖拽划段，或按 <kbd>I</kbd> / <kbd>O</kbd> 标记起止点
            </p>
          </div>
        ) : (
          segments.map((segment, index) => {
            const color = getActionColor(segment.action, orderedActions);
            const isSelected = selectedSet.has(segment.id);
            return (
              <article
                key={segment.id}
                className="segment-row"
                aria-current={isSelected ? "true" : undefined}
              >
                <div
                  role="button"
                  tabIndex={0}
                  className="flex w-full min-w-0 cursor-pointer items-center gap-2 text-left"
                  aria-label={`选择区间 ${index + 1}：${segment.animal} ${segment.action}`}
                  {...labelHints([{ kind: "animal", label: segment.animal }, { kind: "action", label: segment.action }])}
                  data-label-detail="Shift+左键可多选"
                  onClick={(event) => {
                    const sel = window.getSelection()?.toString().trim();
                    if (sel) return;
                    onSelect(segment.id, event.shiftKey);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(segment.id, e.shiftKey);
                    }
                  }}
                >
                  <span className="select-none shrink-0 font-mono text-[10px] text-mute">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
                    <span className="selectable-text select-text">
                      {segment.animal}
                    </span>
                  </span>
                  <span
                    className="action-pill selectable-text max-w-[110px] truncate rounded px-1.5 py-0.5 text-[10px] font-medium select-text"
                    style={actionColorVars(color)}
                    {...labelHint("action", segment.action)}
                  >
                    {segment.action}
                  </span>
                </div>
                <div className="mt-1 pl-5 font-mono text-[10px] text-mute">
                  F{frameIndex(segment.start, fps)} – F
                  {frameIndex(segment.end, fps)}
                </div>
                <div className="segment-fields">
                  <TimeField
                    label="起点"
                    value={segment.start}
                    fps={fps}
                    onCommit={(start) =>
                      onUpdate(segment.id, start, segment.end)
                    }
                  />
                  <TimeField
                    label="终点"
                    value={segment.end}
                    fps={fps}
                    onCommit={(end) => onUpdate(segment.id, segment.start, end)}
                  />
                  <button
                    type="button"
                    className="studio-button !h-[26px] !px-0"
                    title="跳转到起点"
                    aria-label={`跳转区间 ${index + 1}`}
                    onClick={() => onSeek(segment.start)}
                  >
                    <LocateFixed size={12} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="studio-button !h-[26px] !px-0 hover:!border-rose-500/40 hover:!bg-rose-500/15 hover:!text-rose-500"
                    title="删除区间"
                    aria-label={`删除区间 ${index + 1}`}
                    onClick={() => onDelete(segment.id)}
                  >
                    <Trash2 size={12} aria-hidden />
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
});

function TimeField({
  label,
  value,
  fps,
  onCommit,
}: {
  label: string;
  value: number;
  fps: number;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    const next = Number(text);
    setDraft(null);
    if (text === "" || !Number.isFinite(next) || next === value) return;
    onCommit(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
    }
  };
  return (
    <label className="segment-time">
      <span className="shrink-0 text-[10px] text-mute">
        {label === "起点" ? "起" : "止"}
      </span>
      <input
        aria-label={label}
        type="number"
        step={1 / (fps > 0 ? fps : 25)}
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <span className="text-[10px] text-mute" aria-hidden>
        s
      </span>
    </label>
  );
}
