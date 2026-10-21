import { FileJson, Tags, Video } from "lucide-react";
import { formatTime } from "../../format";
import { SegmentedControl } from "../ui/SegmentedControl";
import { ActionRadioGrid, type ActionRadioEntry } from "./ActionRadioGrid";

type Filter = "all" | "done" | "todo";
type Props = {
  entries: ActionRadioEntry[];
  orderedActions: string[];
  selectedAction: string | null | undefined;
  pendingTime: number | null;
  filter: Filter;
  onFilterChange: (filter: Filter) => void;
  onSelectAction: (action: string) => void;
  onOpenLabels: () => void;
  onOpenVideo: () => void;
};

export function BehaviorInspector({
  entries,
  orderedActions,
  selectedAction,
  pendingTime,
  filter,
  onFilterChange,
  onSelectAction,
  onOpenLabels,
  onOpenVideo,
}: Props) {
  return (
    <section
      className="behavior-panel flex h-full min-h-0 flex-col"
      aria-labelledby="behavior-heading"
    >
      <div className="panel-heading">
        <div className="flex items-center gap-2">
          <h2 id="behavior-heading">
            <Tags size={14} aria-hidden />
            可选行为
          </h2>
          <span className="panel-count">{orderedActions.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="在 Finder / 资源管理器中打开所在文件夹并选中原 JSON 文件"
            className="inline-flex h-6 items-center gap-1 rounded border border-line/80 bg-card/50 px-2 text-[11px] font-medium text-mute transition-colors hover:bg-card hover:text-ink"
            onClick={onOpenLabels}
          >
            <FileJson size={12} aria-hidden />
            <span>原 JSON</span>
          </button>
          <button
            type="button"
            title="在 Finder / 资源管理器中打开所在文件夹并选中原视频文件"
            className="inline-flex h-6 items-center gap-1 rounded border border-line/80 bg-card/50 px-2 text-[11px] font-medium text-mute transition-colors hover:bg-card hover:text-ink"
            onClick={onOpenVideo}
          >
            <Video size={12} aria-hidden />
            <span>原视频</span>
          </button>
        </div>
      </div>

      <div className="shrink-0 px-3 pb-2.5 pt-2.5">
        <SegmentedControl
          label="行为筛选"
          value={filter}
          onChange={onFilterChange}
          options={[
            { id: "all", label: "全部" },
            { id: "todo", label: "未标" },
            { id: "done", label: "已标" },
          ]}
        />
      </div>

      {pendingTime !== null && (
        <div
          className="badge-warn mx-3 mb-2.5 flex items-center justify-between rounded-md px-2.5 py-1.5 text-[11px]"
          role="status"
        >
          <span>
            起点已设 <strong className="font-mono">{formatTime(pendingTime)}</strong>
          </span>
          <span className="opacity-85">
            按 <kbd>O</kbd> 标终点
          </span>
        </div>
      )}

      <ActionRadioGrid
        entries={entries}
        orderedActions={orderedActions}
        selectedAction={selectedAction}
        onSelect={onSelectAction}
      />
    </section>
  );
}
