import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileJson,
  HelpCircle,
  Loader2,
  Moon,
  MoreHorizontal,
  RotateCcw,
  Save,
  Sun,
  Video,
} from "lucide-react";
import { cn } from "../../lib/cn";
import { BrandIcon } from "../ui/BrandIcon";
import type { ThemeMode } from "../../types";

export type SavePhase = "idle" | "saving" | "success" | "error";

export function VideoNavigation({ position, total, busy, onNavigate }: {
  position: number; total: number; busy: boolean; onNavigate: (direction: -1 | 1) => void;
}) {
  return (
    <div role="group" aria-label="切换视频" className="inline-flex h-7 shrink-0 items-center rounded-md border border-line bg-card/60">
      <button type="button" aria-label="上一个视频" title="保存当前修改并切换到上一个视频"
        disabled={busy || position <= 0} onClick={() => onNavigate(-1)}
        className="inline-flex h-full items-center gap-1 rounded-l-md px-2 text-xs hover:bg-card disabled:cursor-not-allowed disabled:opacity-35">
        <ChevronLeft size={13} />上一个
      </button>
      <span className="border-x border-line px-1.5 font-mono text-[10px] text-mute" aria-live="polite">
        {position >= 0 ? position + 1 : 0}/{total}
      </span>
      <button type="button" aria-label="下一个视频" title="保存当前修改并切换到下一个视频"
        disabled={busy || position < 0 || position >= total - 1} onClick={() => onNavigate(1)}
        className="inline-flex h-full items-center gap-1 rounded-r-md px-2 text-xs hover:bg-card disabled:cursor-not-allowed disabled:opacity-35">
        下一个<ChevronRight size={13} />
      </button>
    </div>
  );
}

export function commandShortcut(letter: string): string {
  if (typeof navigator === "undefined") return `Ctrl+${letter}`;
  const platform = `${navigator.platform} ${navigator.userAgent}`;
  return /Mac|iPhone|iPad/.test(platform) ? `⌘${letter}` : `Ctrl+${letter}`;
}

export function ThemeToggle({
  theme,
  onChange,
}: {
  theme: ThemeMode;
  onChange: (next: ThemeMode) => void;
}) {
  const isDark = theme === "dark";
  return (
    <div
      role="group"
      aria-label="主题模式切换"
      className="relative inline-grid h-7 grid-cols-2 items-center rounded-lg border border-line/70 bg-card/85 p-0.5 text-[11px]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0.5 top-0.5 rounded-[6px] bg-panel shadow-[0_1px_3px_rgba(15,23,42,0.1)] ring-1 ring-black/[0.04] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          left: 2,
          width: "calc(50% - 2px)",
          transform: `translate3d(${isDark ? 100 : 0}%, 0, 0)`,
        }}
      />
      <button
        type="button"
        aria-pressed={!isDark}
        title="切换为浅色模式"
        onClick={() => onChange("light")}
        className={cn(
          "relative z-10 inline-flex h-full items-center justify-center gap-1 rounded-[6px] px-2 font-medium transition-[color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.95]",
          !isDark ? "text-ink font-semibold" : "text-mute hover:text-ink",
        )}
      >
        <Sun
          size={12}
          className={cn(
            "transition-transform duration-300",
            !isDark ? "rotate-0 text-amber-500" : "-rotate-45",
          )}
        />
        <span>浅色</span>
      </button>
      <button
        type="button"
        aria-pressed={isDark}
        title="切换为深色模式"
        onClick={() => onChange("dark")}
        className={cn(
          "relative z-10 inline-flex h-full items-center justify-center gap-1 rounded-[6px] px-2 font-medium transition-[color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.95]",
          isDark ? "text-ink font-semibold" : "text-mute hover:text-ink",
        )}
      >
        <Moon
          size={12}
          className={cn(
            "transition-transform duration-300",
            isDark ? "rotate-0 text-mark" : "rotate-45",
          )}
        />
        <span>深色</span>
      </button>
    </div>
  );
}

export function StudioBreadcrumb({
  isCardsView,
  datasetName,
  videoName,
  videoId,
  videoMatched,
  onLeave,
}: {
  isCardsView: boolean;
  datasetName: string;
  videoName: string;
  videoId: string;
  videoMatched: boolean;
  onLeave: () => void;
}) {
  const place = datasetName || "样本库";
  if (isCardsView) {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <BrandIcon />
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold tracking-tight text-ink">
            WildVision Studio
          </span>
          <span className="hidden truncate rounded bg-card px-1.5 py-0.5 text-[11px] font-medium text-mute sm:inline">
            生态行为视觉平台
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2">
      <BrandIcon />
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          const sel = window.getSelection()?.toString().trim();
          if (sel) return;
          onLeave();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onLeave();
          }
        }}
        title={`返回 ${place}`}
        className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-line bg-card/60 px-2 text-xs font-medium text-mute transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-card hover:text-ink active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark"
      >
        <ArrowLeft size={13} className="select-none" />
        <span className="selectable-text max-w-[130px] truncate select-text">
          {place}
        </span>
      </div>
      <ChevronRight size={13} className="shrink-0 text-mute/60 select-none" aria-hidden />
      <span
        className="selectable-text min-w-0 truncate text-xs font-semibold text-ink select-text"
        title={videoName || "当前视频"}
      >
        {videoName || "当前视频"}
      </span>
      {videoId && (
        <span
          className={cn(
            "selectable-text inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium select-text",
            videoMatched ? "badge-success" : "badge-warn",
          )}
          title={
            videoMatched
              ? `video_id: ${videoId} 已对齐`
              : `video_id: ${videoId} 与文件名不一致`
          }
        >
          {videoMatched ? (
            <CheckCircle2 size={10} className="select-none" />
          ) : (
            <AlertTriangle size={10} className="select-none" />
          )}
          <span className="selectable-text select-text">{videoId}</span>
        </span>
      )}
    </div>
  );
}

export function SaveButton({
  phase,
  dirty,
  inDataset,
  onSave,
}: {
  phase: SavePhase;
  dirty: boolean;
  inDataset: boolean;
  onSave: () => void;
}) {
  const shortcut = commandShortcut("S");
  let label = "导出 JSON";
  if (phase === "saving") label = inDataset ? "保存中" : "导出中";
  else if (phase === "error") label = inDataset ? "保存失败" : "导出失败";
  else if (inDataset) label = dirty ? `保存 ${shortcut}` : "已保存";
  else if (phase === "success" && !dirty) label = "已导出";
  const busy = phase === "saving";
  const failed = phase === "error";
  const saved =
    phase !== "error" &&
    phase !== "saving" &&
    ((inDataset && !dirty) || (!inDataset && phase === "success"));
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark",
        failed
          ? "bg-rose-600 text-white hover:bg-rose-500"
          : saved
            ? "border border-line bg-card/50 text-mute hover:bg-card hover:text-ink"
            : "bg-mark text-white hover:brightness-110",
      )}
      aria-busy={busy}
      onClick={onSave}
    >
      {busy ? (
        <Loader2
          size={12}
          className="animate-spin motion-reduce:animate-none"
        />
      ) : saved ? (
        <Check size={12} className="text-emerald-500" />
      ) : (
        <Save size={12} />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}

export function OverflowMenu({
  exportLabel,
  onExport,
  onOpenLabels,
  onOpenVideo,
  onToggleGuide,
  onResetLayout,
}: {
  exportLabel: string;
  onExport: () => void;
  onOpenLabels?: () => void;
  onOpenVideo?: () => void;
  onToggleGuide?: () => void;
  onResetLayout: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;
    const anchor = buttonRef.current.getBoundingClientRect();
    const menu = menuRef.current.getBoundingClientRect();
    let left = anchor.right - menu.width;
    left = Math.max(8, Math.min(left, window.innerWidth - menu.width - 8));
    let top = anchor.bottom + 6;
    if (top + menu.height > window.innerHeight - 8)
      top = Math.max(8, anchor.top - menu.height - 6);
    setPos((prev) =>
      prev.top === top && prev.left === left ? prev : { top, left },
    );
    itemRefs.current[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      )
        return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement =>
      Boolean(item),
    );
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Home" ||
      event.key === "End"
    ) {
      event.preventDefault();
      event.stopPropagation();
      let next = current < 0 ? 0 : current;
      if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else if (event.key === "ArrowDown")
        next = Math.min(items.length - 1, next + 1);
      else next = Math.max(0, next - 1);
      items[next]?.focus();
    }
  };

  const choose = (action: () => void) => {
    setOpen(false);
    buttonRef.current?.focus();
    action();
  };

  let refIdx = 0;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="更多操作"
        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-card/60 text-xs font-medium text-ink transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-card active:scale-[0.94] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark"
        onClick={() => setOpen((value) => !value)}
      >
        <MoreHorizontal size={14} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="更多操作"
          data-key-scope="studio-field"
          className="fixed z-50 w-44 rounded-lg border border-line bg-panel p-1 shadow-xl"
          style={{ top: pos.top, left: pos.left }}
          onKeyDown={onMenuKey}
        >
          {onOpenLabels && (
            <button
              ref={(node) => {
                itemRefs.current[refIdx++] = node;
              }}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark"
              onClick={() => choose(onOpenLabels)}
            >
              <FileJson size={13} className="text-mute" />
              载入预处理 JSON
            </button>
          )}
          {onOpenVideo && (
            <button
              ref={(node) => {
                itemRefs.current[refIdx++] = node;
              }}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark"
              onClick={() => choose(onOpenVideo)}
            >
              <Video size={13} className="text-mute" />
              更换视频文件
            </button>
          )}
          <button
            ref={(node) => {
              itemRefs.current[refIdx++] = node;
            }}
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark"
            onClick={() => choose(onExport)}
          >
            <Save size={13} className="text-mute" />
            {exportLabel}
          </button>
          {onToggleGuide && (
            <button
              ref={(node) => {
                itemRefs.current[refIdx++] = node;
              }}
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-ink transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark"
              onClick={() => choose(onToggleGuide)}
            >
              <HelpCircle size={13} className="text-mute" />
              切换操作引导提示
            </button>
          )}
          <button
            ref={(node) => {
              itemRefs.current[refIdx++] = node;
            }}
            type="button"
            role="menuitem"
            className="mt-0.5 flex w-full items-center gap-2 rounded-md border-t border-line px-2.5 pb-1.5 pt-1.5 text-left text-xs text-mute transition-colors hover:bg-card hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark"
            onClick={() => choose(onResetLayout)}
          >
            <RotateCcw size={13} />
            重置工作台布局
          </button>
        </div>
      ) : null}
    </div>
  );
}
