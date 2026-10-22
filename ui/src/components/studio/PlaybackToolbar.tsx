import {
  Eye,
  EyeOff,
  FastForward,
  Flag,
  Pause,
  Play,
  Redo2,
  Rewind,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { formatTime } from "../../format";
import { cn } from "../../lib/cn";
import { PlaybackSpeedControl } from "./PlaybackSpeedControl";
import {
  DockButton,
  FloatingDock,
  Hint,
  redoShortcut,
  ToolbarDivider,
  ToolbarGroup,
  ToolbarSeparator,
  undoShortcut,
} from "./FloatingDock";

type Props = {
  current: number;
  duration: number;
  fps: number;
  status: string;
  playing: boolean;
  muted?: boolean;
  volume?: number;
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => boolean;
  pendingTime: number | null;
  activeSegmentId: string | null;
  selectedCount?: number;
  canUndo: boolean;
  canRedo?: boolean;
  showFrameOverlay?: boolean;
  onToggleFrameOverlay?: () => void;
  onTogglePlay: () => void;
  onToggleMute?: () => void;
  onVolumeChange?: (volume: number) => void;
  onStepFrames: (delta: number) => void;
  onStepSeconds: (delta: number) => void;
  onMarkStart: () => void;
  onMarkEnd: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onUndo: () => void;
  onRedo?: () => void;
};

export function PlaybackToolbar({
  current,
  duration,
  fps,
  status,
  playing,
  muted = false,
  volume = 0.5,
  playbackRate,
  onPlaybackRateChange,
  pendingTime,
  activeSegmentId,
  selectedCount = 0,
  canUndo,
  canRedo = false,
  showFrameOverlay = true,
  onToggleFrameOverlay,
  onTogglePlay,
  onToggleMute,
  onVolumeChange,
  onStepFrames,
  onStepSeconds,
  onMarkStart,
  onMarkEnd,
  onCancel,
  onDelete,
  onUndo,
  onRedo,
}: Props) {
  const hasSelection = Boolean(activeSegmentId || selectedCount > 0);
  const effectiveVolume = muted ? 0 : Math.max(0, Math.min(1, volume));
  const volumePercent = Math.round(effectiveVolume * 100);

  return (
    <FloatingDock
      current={current}
      duration={duration}
      fps={fps}
      status={status}
    >
      {/* 21st.dev @preetsuthar17/components/toolbar style icon pill */}
      <ToolbarGroup label="播放控制">
        <DockButton
          label="快退 1 秒"
          shortcut="J"
          iconOnly
          onClick={() => onStepSeconds(-1)}
        >
          <Rewind />
        </DockButton>
        <DockButton
          label="上一帧"
          shortcut="←"
          iconOnly
          onClick={() => onStepFrames(-1)}
        >
          <SkipBack />
        </DockButton>
        <DockButton
          label={playing ? "暂停" : "播放"}
          shortcut="Space"
          iconOnly
          active={playing}
          tone="primary"
          onClick={onTogglePlay}
        >
          {playing ? (
            <Pause className="fill-current" />
          ) : (
            <Play className="translate-x-[0.5px] fill-current" />
          )}
        </DockButton>
        <DockButton
          label="下一帧"
          shortcut="→"
          iconOnly
          onClick={() => onStepFrames(1)}
        >
          <SkipForward />
        </DockButton>
        <DockButton
          label="快进 1 秒"
          shortcut="L"
          iconOnly
          onClick={() => onStepSeconds(1)}
        >
          <FastForward />
        </DockButton>

        {onToggleMute && (
          <>
            <ToolbarDivider />
            <div className="group/vol inline-flex items-center gap-1.5 pr-1">
              <DockButton
                label={
                  effectiveVolume === 0
                    ? "取消静音"
                    : `静音（当前 ${volumePercent}%）`
                }
                shortcut="M"
                iconOnly
                active={effectiveVolume > 0}
                onClick={onToggleMute}
              >
                {effectiveVolume === 0 ? (
                  <VolumeX className="text-mute" />
                ) : effectiveVolume < 0.5 ? (
                  <Volume1 />
                ) : (
                  <Volume2 />
                )}
              </DockButton>

              {onVolumeChange && (
                <Hint text={`调节音量 (${volumePercent}%)`}>
                  <div className="flex items-center gap-1.5">
                    <div className="relative flex h-5 w-14 items-center">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-card ring-1 ring-inset ring-line/70">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-100",
                            effectiveVolume === 0 ? "bg-mute/40" : "bg-mark",
                          )}
                          style={{ width: `${volumePercent}%` }}
                        />
                      </div>
                      <span
                        className={cn(
                          "pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-white shadow ring-1 transition-transform duration-150 group-hover/vol:scale-110",
                          effectiveVolume === 0
                            ? "ring-line"
                            : "ring-mark",
                        )}
                        style={{ left: `${volumePercent}%` }}
                      />
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={volumePercent}
                        aria-label="音量大小"
                        onChange={(event) =>
                          onVolumeChange(Number(event.target.value) / 100)
                        }
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                    </div>
                    <span className="w-7 select-none text-right font-mono text-[10px] font-medium tabular-nums text-mute">
                      {volumePercent}%
                    </span>
                  </div>
                </Hint>
              )}
            </div>
          </>
        )}
        <ToolbarDivider />
        <PlaybackSpeedControl value={playbackRate} onChange={onPlaybackRateChange} disabled={duration <= 0} />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup label="标注操作">
        <DockButton
          label={
            pendingTime !== null
              ? `起点 ${formatTime(pendingTime)}`
              : "标起点"
          }
          shortcut="I"
          keepLabel
          tone="good"
          onClick={onMarkStart}
        >
          <Flag />
        </DockButton>
        <DockButton
          label="标终点"
          shortcut="O"
          keepLabel
          tone="good"
          disabled={pendingTime === null}
          onClick={onMarkEnd}
        >
          <Flag className="rotate-180" />
        </DockButton>
        <DockButton
          label="取消起点"
          shortcut="Esc"
          iconOnly
          disabled={pendingTime === null}
          onClick={onCancel}
        >
          <X />
        </DockButton>
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup label="编辑操作">
        <DockButton
          label={selectedCount > 1 ? `删除选中的 ${selectedCount} 段` : "删除选中区间"}
          shortcut="Delete"
          iconOnly
          disabled={!hasSelection}
          onClick={onDelete}
        >
          <Trash2 />
        </DockButton>
        <DockButton
          label="撤销上一步"
          shortcut={undoShortcut()}
          iconOnly
          disabled={!canUndo}
          onClick={onUndo}
        >
          <Undo2 />
        </DockButton>
        {onRedo && (
          <DockButton
            label="重做恢复"
            shortcut={redoShortcut()}
            iconOnly
            disabled={!canRedo}
            onClick={onRedo}
          >
            <Redo2 />
          </DockButton>
        )}
        {onToggleFrameOverlay && (
          <>
            <ToolbarDivider />
            <DockButton
              label={showFrameOverlay ? "帧标签: 开" : "帧标签: 关"}
              shortcut="V"
              keepLabel
              active={showFrameOverlay}
              tone={showFrameOverlay ? "primary" : "idle"}
              onClick={onToggleFrameOverlay}
            >
              {showFrameOverlay ? <Eye /> : <EyeOff />}
            </DockButton>
          </>
        )}
      </ToolbarGroup>
    </FloatingDock>
  );
}
