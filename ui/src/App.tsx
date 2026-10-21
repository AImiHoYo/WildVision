import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { call, onReady } from "./bridge";
import {
  reconcileOverlappingSegments,
  resolvePastePlan,
  type ClipboardSnapshot,
} from "./lib/annotationClipboard";
import { clampPlaybackTime } from "./lib/playback";
import { BehaviorInspector } from "./components/studio/BehaviorInspector";
import { FrameAnimalOverlay } from "./components/studio/FrameAnimalOverlay";
import { AnimatedTabs } from "./components/ui/AnimatedTabs";
import { DatasetCards } from "./components/dataset/DatasetCards";
import { PlaybackToolbar } from "./components/studio/PlaybackToolbar";
import { EvaluatePanels } from "./components/evaluation/EvaluatePanels";
import {
  DEFAULT_STUDIO_LAYOUT,
  readStudioLayout,
  SplitPane,
  STUDIO_LAYOUT_KEY,
  type StudioLayout,
} from "./components/ui/SplitPane";
import {
  OverflowMenu,
  SaveButton,
  StudioBreadcrumb,
  ThemeToggle,
  VideoNavigation,
  type SavePhase,
} from "./components/studio/StudioHeader";
import { SegmentList } from "./components/studio/SegmentList";
import { Timeline } from "./components/studio/Timeline";
import {
  EMPTY_STATE,
  isFullState,
  type ApiResult,
  type DesktopState,
  type SegmentItem,
  type ThemeMode,
} from "./types";

const THEME_STORAGE_KEY = "wildvision.theme";
const FRAME_OVERLAY_STORAGE_KEY = "wildvision.showFrameOverlay";

function readInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // ignore storage access errors
  }
  return "light";
}

function readInitialFrameOverlay(): boolean {
  try {
    const saved = localStorage.getItem(FRAME_OVERLAY_STORAGE_KEY);
    if (saved === "false") return false;
    if (saved === "true") return true;
  } catch {
    // ignore storage access errors
  }
  return true;
}

type DialogState =
  | { kind: "demo" | "empty"; message: string }
  | {
      kind: "replace_project" | "merge_or_replace";
      message: string;
      text: string;
    }
  | { kind: "restore"; message: string; path: string }
  | { kind: "leave_dirty_card"; message: string }
  | null;

function editingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}

function inStudioField(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("[data-key-scope='studio-field']"))
  );
}

export function App() {
  const [theme, setTheme] = useState<ThemeMode>(readInitialTheme);
  const [cardsTab, setCardsTab] = useState<"cards" | "analytics">("cards");
  const [state, setState] = useState<DesktopState>(EMPTY_STATE);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [current, setCurrent] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [labelFilter, setLabelFilter] = useState<"all" | "done" | "todo">(
    "all",
  );
  const [dragging, setDragging] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [showFrameOverlay, setShowFrameOverlay] = useState<boolean>(
    readInitialFrameOverlay,
  );
  const [layout, setLayout] = useState<StudioLayout>(readStudioLayout);
  const [narrowStudio, setNarrowStudio] = useState(false);
  const studioRef = useRef<HTMLDivElement>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [hasSeparateAudio, setHasSeparateAudio] = useState(false);
  const stateRef = useRef(state);
  const dialogRef = useRef(dialog);
  const currentRef = useRef(0);
  const lastTimeUiUpdateMsRef = useRef(0);
  const pendingSeekRef = useRef<number | null>(null);
  const editEpoch = useRef(0);
  const savingRef = useRef(false);
  const navigatingRef = useRef(false);
  const [navigating, setNavigating] = useState(false);
  const [savePhase, setSavePhase] = useState<SavePhase>("idle");
  const playAfterSeekRef = useRef(false);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>([]);
  const selectedSegmentIdsRef = useRef<string[]>([]);
  const undoStackRef = useRef<SegmentItem[][]>([]);
  const redoStackRef = useRef<SegmentItem[][]>([]);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const clipboardRef = useRef<ClipboardSnapshot | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);

  stateRef.current = state;
  dialogRef.current = dialog;
  selectedSegmentIdsRef.current = selectedSegmentIds;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // ignore storage errors
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(FRAME_OVERLAY_STORAGE_KEY, String(showFrameOverlay));
    } catch {
      // ignore storage errors
    }
  }, [showFrameOverlay]);

  useEffect(() => {
    setHasSeparateAudio(false);
  }, [state.video_url]);

  useEffect(() => {
    const clamped = Math.max(0, Math.min(1, volume));
    const video = videoRef.current;
    const audio = audioRef.current;
    if (video) {
      video.muted = hasSeparateAudio ? true : muted;
      video.volume = clamped;
    }
    if (audio) {
      audio.muted = muted;
      audio.volume = clamped;
    }
  }, [muted, volume, hasSeparateAudio, state.video_url]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (!next && volume <= 0) {
        setVolume(0.5);
      }
      return next;
    });
  }, [volume]);

  const handleVolumeChange = useCallback((nextVol: number) => {
    const clamped = Math.max(0, Math.min(1, nextVol));
    setVolume(clamped);
    setMuted(clamped === 0);
  }, []);

  const applyVideoTime = useCallback(
    (video: HTMLVideoElement, target: number) => {
      try {
        if (video.seeking) {
          pendingSeekRef.current = target;
          return;
        }
        pendingSeekRef.current = null;
        video.currentTime = target;
        const audio = audioRef.current;
        if (audio && audio.readyState >= 1) {
          audio.currentTime = target;
        }
      } catch {
        pendingSeekRef.current = target;
      }
    },
    [],
  );

  const seekTo = useCallback(
    (time: number, play = false) => {
      const video = videoRef.current;
      const audio = audioRef.current;
      const clamped = clampPlaybackTime(time, video?.duration);
      currentRef.current = clamped;
      setCurrent(clamped);
      if (play) playAfterSeekRef.current = true;

      if (!video) return;
      if (!play && !video.paused) {
        video.pause();
        audio?.pause();
      }
      applyVideoTime(video, clamped);
      if (play && !video.seeking && pendingSeekRef.current === null) {
        playAfterSeekRef.current = false;
        void video.play().catch(() => undefined);
        if (audio && audio.readyState >= 1) {
          audio.currentTime = clamped;
          void audio.play().catch(() => undefined);
        }
      }
    },
    [applyVideoTime],
  );

  const onVideoSeeked = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (pendingSeekRef.current !== null) {
      const next = pendingSeekRef.current;
      pendingSeekRef.current = null;
      applyVideoTime(video, next);
      return;
    }
    const audio = audioRef.current;
    if (audio && audio.readyState >= 1) {
      audio.currentTime = video.currentTime || 0;
    }
    if (playAfterSeekRef.current) {
      playAfterSeekRef.current = false;
      void video.play().catch(() => undefined);
    }
  }, [applyVideoTime]);

  const absorb = useCallback(
    (result: ApiResult) => {
      if (!result.ok) {
        setState((prev) => ({
          ...prev,
          status_message: result.message || "操作没有完成。",
        }));
        return;
      }
      if (!isFullState(result)) return;
      if (result.is_dirty) editEpoch.current += 1;
      setState((prev) => {
        if (Array.isArray(result.dataset_items)) {
          return result;
        }
        // When dataset_items is omitted on large 100k+ datasets during studio edits,
        // preserve prev.dataset_items and patch only the single active card in O(1)/single-card update.
        let nextDatasetItems = prev.dataset_items;
        const patch = result.active_card_patch;
        if (patch && patch.video_id && prev.dataset_items && prev.dataset_items.length > 0) {
          const idx = prev.dataset_items.findIndex((it) => it.video_id === patch.video_id);
          if (idx >= 0) {
            nextDatasetItems = prev.dataset_items.slice();
            nextDatasetItems[idx] = patch;
          }
        }
        return {
          ...result,
          dataset_items: nextDatasetItems,
        };
      });
      if (Array.isArray(result.segments)) {
        const validIds = new Set(result.segments.map((s) => s.id));
        const pruned = selectedSegmentIdsRef.current.filter((id) =>
          validIds.has(id),
        );
        if (pruned.length !== selectedSegmentIdsRef.current.length) {
          selectedSegmentIdsRef.current = pruned;
          setSelectedSegmentIds(pruned);
        }
      }
      if (typeof result.seek_to === "number") {
        seekTo(result.seek_to, false);
      }
      if (result.needs_confirm === "demo")
        setDialog({ kind: "demo", message: result.status_message });
      if (result.needs_confirm === "empty_labels")
        setDialog({ kind: "empty", message: result.status_message });
      if (result.needs_confirm === "leave_dirty_card") {
        setDialog({ kind: "leave_dirty_card", message: result.status_message });
      }
      if (result.needs_confirm === "replace_project") {
        setDialog({
          kind: "replace_project",
          message: result.status_message,
          text: result.pending_text || "",
        });
      }
      if (result.needs_confirm === "merge_or_replace") {
        setDialog({
          kind: "merge_or_replace",
          message: result.status_message,
          text: result.pending_text || "",
        });
      }
    },
    [seekTo],
  );

  const syncHistoryFlags = useCallback(() => {
    setHistoryState({
      canUndo: undoStackRef.current.length > 0,
      canRedo: redoStackRef.current.length > 0,
    });
  }, []);

  const pushUndoSnapshot = useCallback(
    (snapshot?: SegmentItem[]) => {
      const source = snapshot ?? stateRef.current.segments;
      undoStackRef.current.push(source.map((s) => ({ ...s })));
      if (undoStackRef.current.length > 50) {
        undoStackRef.current.shift();
      }
      redoStackRef.current = [];
      syncHistoryFlags();
    },
    [syncHistoryFlags],
  );

  const clearHistoryStacks = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncHistoryFlags();
  }, [syncHistoryFlags]);

  const run = useCallback(
    async (
      name: string,
      ...args: unknown[]
    ): Promise<ApiResult | undefined> => {
      try {
        let result = await call(name, ...args);
        if (
          name === "mark_end" ||
          name === "update_segment" ||
          name === "open_card" ||
          name === "parse_text"
        ) {
          result = await reconcileOverlappingSegments(result);
        }
        if (result.ok && !result.needs_confirm && (
          name === "navigate_card" ||
          name === "open_card" ||
          name === "load_demo" ||
          name === "switch_dataset" ||
          name === "leave_card"
        )) {
          clearHistoryStacks();
          setSelectedSegmentIds([]);
          selectedSegmentIdsRef.current = [];
        }
        absorb(result);
        return result;
      } catch (error) {
        setState((prev) => ({
          ...prev,
          status_message:
            error instanceof Error ? error.message : "桌面接口还没准备好。",
        }));
        return undefined;
      }
    },
    [absorb, clearHistoryStacks],
  );

  const navigateVideo = useCallback(async (direction: -1 | 1) => {
    if (navigatingRef.current || savingRef.current) return;
    navigatingRef.current = true;
    setNavigating(true);
    videoRef.current?.pause();
    audioRef.current?.pause();
    try {
      const result = await run("navigate_card", direction, stateRef.current.active_card_id);
      if (result?.ok) {
        setCurrent(0);
        currentRef.current = 0;
        setMediaDuration(0);
        setPlaying(false);
        pendingSeekRef.current = null;
        playAfterSeekRef.current = false;
        setSavePhase("idle");
      }
    } finally {
      navigatingRef.current = false;
      setNavigating(false);
    }
  }, [run]);

  const changeSegmentAction = useCallback(async (id: string, action: string) => {
    const before = stateRef.current.segments.map((s) => ({ ...s }));
    if (before.find((s) => s.id === id)?.action === action) return;
    const result = await run("change_segment_action", id, action);
    if (result?.ok) {
      pushUndoSnapshot(before);
      setSelectedSegmentIds([id]);
      selectedSegmentIdsRef.current = [id];
    }
  }, [run, pushUndoSnapshot]);

  const saveCard = useCallback(async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSavePhase("saving");
    const started = editEpoch.current;
    const inCard = Boolean(
      stateRef.current.workspace_dir && stateRef.current.active_card_id,
    );
    try {
      const result = await call(
        inCard ? "save_current_card" : "export_json",
        ...(inCard ? [] : [false, ""]),
      );
      if (
        isFullState(result) &&
        result.is_dirty === false &&
        editEpoch.current !== started
      ) {
        result.is_dirty = true;
      }
      absorb(result);
      const message = `${result.message || ""} ${result.status_message || ""}`;
      if (!result.ok) setSavePhase("error");
      else if (result.needs_confirm || message.includes("已取消"))
        setSavePhase("idle");
      else if (
        !result.is_dirty &&
        (message.includes("已保存") || message.includes("已导出"))
      )
        setSavePhase("success");
      else setSavePhase("idle");
    } catch (error) {
      setSavePhase("error");
      setState((prev) => ({
        ...prev,
        status_message:
          error instanceof Error ? error.message : "保存没有完成。",
      }));
    } finally {
      savingRef.current = false;
    }
  }, [absorb]);

  useEffect(() => {
    let gone = false;
    const boot = async () => {
      try {
        let currentState = await call("get_state");
        currentState = await reconcileOverlappingSegments(currentState);
        if (gone) return;
        absorb(currentState);
        if (
          isFullState(currentState) &&
          (!currentState.dataset_items || currentState.dataset_items.length === 0) &&
          currentState.available_datasets &&
          currentState.available_datasets.length > 0
        ) {
          const switched = await call(
            "switch_dataset",
            currentState.available_datasets[0].folder_name,
          );
          if (!gone) absorb(switched);
        }
      } catch {
        if (!gone) markOffline();
      }
    };
    const markOffline = () => {
      setState((prev) =>
        prev.status_message === "正在连接桌面程序…"
          ? { ...prev, status_message: "就绪" }
          : prev,
      );
    };
    onReady(() => {
      void boot();
    });
    const timer = window.setTimeout(() => {
      if (!window.pywebview?.api) markOffline();
    }, 1200);
    const autosave = window.setInterval(() => {
      if (window.pywebview?.api && stateRef.current.view_mode === "studio") {
        void call("autosave").catch(() => undefined);
      }
    }, 5000);
    return () => {
      gone = true;
      window.clearTimeout(timer);
      window.clearInterval(autosave);
    };
  }, [absorb]);

  const requireVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video || !stateRef.current.video_url) {
      setState((prev) => ({
        ...prev,
        status_message: "请先打开视频或点试用示例。",
      }));
      return null;
    }
    return video;
  }, []);

  const togglePlay = useCallback(() => {
    const video = requireVideo();
    if (!video) return;
    const audio = audioRef.current;
    if (video.paused) {
      if (audio && audio.readyState >= 1) {
        audio.currentTime = video.currentTime || 0;
        audio.muted = muted;
        audio.volume = Math.max(0, Math.min(1, volume));
        void audio.play().catch(() => undefined);
      }
      void video.play().catch(() => undefined);
    } else {
      video.pause();
      audio?.pause();
    }
  }, [muted, requireVideo, volume]);

  const stepFrames = useCallback(
    (count: number) => {
      if (!requireVideo()) return;
      const fps = stateRef.current.fps || 25;
      seekTo(currentRef.current + count / fps, false);
    },
    [requireVideo, seekTo],
  );

  const stepSeconds = useCallback(
    (seconds: number) => {
      if (!requireVideo()) return;
      seekTo(currentRef.current + seconds, false);
    },
    [requireVideo, seekTo],
  );

  const handleMarkStart = useCallback(() => {
    const video = requireVideo();
    if (!video) return;
    video.pause();
    void run(
      "mark_start",
      currentRef.current,
      stateRef.current.selected_track_index ?? 0,
      stateRef.current.selected_action ?? null,
    );
  }, [requireVideo, run]);

  const applySegmentsSnapshot = useCallback(
    async (targetSegments: SegmentItem[], statusMessage: string) => {
      const currentSegs = stateRef.current.segments;
      const targetById = new Map(targetSegments.map((s) => [s.id, s]));
      const currentById = new Map(currentSegs.map((s) => [s.id, s]));
      let latestRes: ApiResult | undefined;

      for (const cur of currentSegs) {
        if (!targetById.has(cur.id)) {
          latestRes = await call("delete_segment", cur.id);
        }
      }

      for (const tgt of targetSegments) {
        const cur = currentById.get(tgt.id);
        if (cur && cur.action !== tgt.action) {
          latestRes = await call("change_segment_action", tgt.id, tgt.action, false);
          if (!latestRes.ok) { absorb(latestRes); return; }
        }
        if (
          cur &&
          (Math.abs(cur.start - tgt.start) > 1e-6 ||
            Math.abs(cur.end - tgt.end) > 1e-6)
        ) {
          latestRes = await call(
            "update_segment",
            tgt.id,
            tgt.start,
            tgt.end,
            false,
          );
        }
      }

      const idReplacementMap = new Map<string, string>();
      for (const tgt of targetSegments) {
        if (!currentById.has(tgt.id)) {
          const trackIdx =
            typeof tgt.track_index === "number" ? tgt.track_index : 0;
          const beforeIds = new Set(
            (latestRes && isFullState(latestRes)
              ? latestRes.segments
              : stateRef.current.segments
            ).map((s) => s.id),
          );
          await call("select_action", tgt.action);
          await call("mark_start", tgt.start, trackIdx, tgt.action);
          latestRes = await call("mark_end", tgt.end, trackIdx, tgt.action);
          if (latestRes && isFullState(latestRes)) {
            const created = latestRes.segments.find(
              (s) => !beforeIds.has(s.id),
            );
            if (created) {
              idReplacementMap.set(tgt.id, created.id);
            }
          }
        }
      }

      if (idReplacementMap.size > 0) {
        const remapStack = (stack: SegmentItem[][]) =>
          stack.map((snap) =>
            snap.map((item) => {
              const newId = idReplacementMap.get(item.id);
              return newId ? { ...item, id: newId } : item;
            }),
          );
        undoStackRef.current = remapStack(undoStackRef.current);
        redoStackRef.current = remapStack(redoStackRef.current);
      }

      if (!latestRes || !isFullState(latestRes)) {
        latestRes = await call("get_state");
      }
      if (latestRes && isFullState(latestRes)) {
        absorb({
          ...latestRes,
          is_dirty: true,
          status_message: statusMessage,
          message: statusMessage,
        });
        const validIds = new Set(latestRes.segments.map((s) => s.id));
        setSelectedSegmentIds((prev) => {
          const next = prev
            .map((id) => idReplacementMap.get(id) ?? id)
            .filter((id) => validIds.has(id));
          selectedSegmentIdsRef.current = next;
          return next;
        });
      }
    },
    [absorb],
  );

  const handleUndo = useCallback(async () => {
    if (undoStackRef.current.length === 0) {
      setState((prev) => ({
        ...prev,
        status_message: "没有可撤销的操作。",
      }));
      return;
    }
    const currentSnap = stateRef.current.segments.map((s) => ({ ...s }));
    const previousSnap = undoStackRef.current.pop()!;
    redoStackRef.current.push(currentSnap);
    syncHistoryFlags();
    await applySegmentsSnapshot(previousSnap, "已撤销上一步标注操作。");
  }, [applySegmentsSnapshot, syncHistoryFlags]);

  const handleRedo = useCallback(async () => {
    if (redoStackRef.current.length === 0) {
      setState((prev) => ({
        ...prev,
        status_message: "没有可恢复重做的操作。",
      }));
      return;
    }
    const currentSnap = stateRef.current.segments.map((s) => ({ ...s }));
    const nextSnap = redoStackRef.current.pop()!;
    undoStackRef.current.push(currentSnap);
    syncHistoryFlags();
    await applySegmentsSnapshot(nextSnap, "已恢复重做标注操作。");
  }, [applySegmentsSnapshot, syncHistoryFlags]);

  const handleSelectSegment = useCallback(
    async (id: string, multi = false) => {
      const validSet = new Set(stateRef.current.segments.map((s) => s.id));
      const currentIds = (
        selectedSegmentIdsRef.current.length > 0
          ? selectedSegmentIdsRef.current
          : stateRef.current.active_segment_id
            ? [stateRef.current.active_segment_id]
            : []
      ).filter((sid) => validSet.has(sid));

      if (multi) {
        let nextIds: string[];
        if (currentIds.includes(id)) {
          nextIds = currentIds.filter((sid) => sid !== id);
        } else {
          nextIds = [...currentIds, id];
        }
        setSelectedSegmentIds(nextIds);
        selectedSegmentIdsRef.current = nextIds;
        if (nextIds.length > 0) {
          const primaryId = nextIds[nextIds.length - 1];
          const res = await call("select_segment", primaryId);
          if (res.ok && isFullState(res)) {
            absorb({
              ...res,
              status_message:
                nextIds.length > 1
                  ? `已多选 ${nextIds.length} 段标注（可按 Ctrl+C 复制、Ctrl+V 粘贴）。`
                  : res.status_message,
            });
          }
        } else {
          const res = await call("deselect_segment");
          absorb(res);
        }
      } else {
        setSelectedSegmentIds([id]);
        selectedSegmentIdsRef.current = [id];
        const res = await call("select_segment", id);
        absorb(res);
      }
    },
    [absorb],
  );

  const handleDeselectSegment = useCallback(async () => {
    setSelectedSegmentIds([]);
    selectedSegmentIdsRef.current = [];
    const res = await call("deselect_segment");
    absorb(res);
  }, [absorb]);

  const handleMarkEnd = useCallback(async () => {
    const video = requireVideo();
    if (!video) return;
    video.pause();
    const st = stateRef.current;
    const pTime = st.pending_time;
    const endT = currentRef.current;
    const trackIndex = st.pending_track_index ?? st.selected_track_index ?? 0;
    const action = st.pending_action ?? st.selected_action ?? null;
    pushUndoSnapshot();
    if (pTime !== null && action) {
      const s = Math.min(pTime, endT);
      const e = Math.max(pTime, endT);
      const epsilon = 1e-4;
      const overlapping = st.segments.filter(
        (seg) =>
          (seg.track_index ?? 0) === trackIndex &&
          seg.action === action &&
          s <= seg.end + epsilon &&
          e >= seg.start - epsilon,
      );
      if (overlapping.length > 0) {
        const primary = overlapping[0];
        const mergedStart = Math.min(s, ...overlapping.map((seg) => seg.start));
        const mergedEnd = Math.max(e, ...overlapping.map((seg) => seg.end));
        await call("cancel_pending");
        let res = await call(
          "update_segment",
          primary.id,
          mergedStart,
          mergedEnd,
          true,
        );
        res = await reconcileOverlappingSegments(res, primary.id);
        absorb(res);
        setSelectedSegmentIds([primary.id]);
        selectedSegmentIdsRef.current = [primary.id];
        return;
      }
    }
    const res = await run(
      "mark_end",
      endT,
      st.selected_track_index ?? 0,
      st.selected_action ?? null,
    );
    if (res && isFullState(res) && res.active_segment_id) {
      setSelectedSegmentIds([res.active_segment_id]);
      selectedSegmentIdsRef.current = [res.active_segment_id];
    }
  }, [absorb, pushUndoSnapshot, requireVideo, run]);

  const handleCreateSegment = useCallback(
    async (
      _animal: string,
      action: string,
      start: number,
      end: number,
      trackIndex: number,
    ) => {
      try {
        const s = Math.min(start, end);
        const e = Math.max(start, end);
        pushUndoSnapshot();
        const epsilon = 1e-4;
        const overlapping = stateRef.current.segments.filter(
          (seg) =>
            (seg.track_index ?? 0) === trackIndex &&
            seg.action === action &&
            s <= seg.end + epsilon &&
            e >= seg.start - epsilon,
        );
        if (overlapping.length > 0) {
          const primary = overlapping[0];
          const mergedStart = Math.min(
            s,
            ...overlapping.map((seg) => seg.start),
          );
          const mergedEnd = Math.max(
            e,
            ...overlapping.map((seg) => seg.end),
          );
          let res = await call(
            "update_segment",
            primary.id,
            mergedStart,
            mergedEnd,
            true,
          );
          res = await reconcileOverlappingSegments(res, primary.id);
          absorb(res);
          const activeId = (res && isFullState(res) && res.active_segment_id) || primary.id;
          setSelectedSegmentIds([activeId]);
          selectedSegmentIdsRef.current = [activeId];
          return;
        }
        if (stateRef.current.selected_action !== action) {
          await call("select_action", action);
        }
        const startRes = await call("mark_start", s, trackIndex, action);
        if (!startRes.ok) {
          absorb(startRes);
          return;
        }
        let res = await call("mark_end", e, trackIndex, action);
        res = await reconcileOverlappingSegments(res);
        absorb(res);
        if (res && isFullState(res) && res.active_segment_id) {
          setSelectedSegmentIds([res.active_segment_id]);
          selectedSegmentIdsRef.current = [res.active_segment_id];
        }
      } catch (error) {
        setState((prev) => ({
          ...prev,
          status_message:
            error instanceof Error ? error.message : "区间创建失败。",
        }));
      }
    },
    [absorb, pushUndoSnapshot],
  );

  const handleDeleteSelectedSegments = useCallback(
    async (explicitId?: string) => {
      const validSet = new Set(stateRef.current.segments.map((s) => s.id));
      const currentIds = (
        selectedSegmentIdsRef.current.length > 0
          ? selectedSegmentIdsRef.current
          : stateRef.current.active_segment_id
            ? [stateRef.current.active_segment_id]
            : []
      ).filter((sid) => validSet.has(sid));

      const targets =
        explicitId && !currentIds.includes(explicitId)
          ? [explicitId]
          : currentIds.length > 0
            ? currentIds
            : explicitId
              ? [explicitId]
              : [];
      if (targets.length === 0) return;

      pushUndoSnapshot();
      let latestRes: ApiResult | undefined;
      for (const id of targets) {
        latestRes = await call("delete_segment", id);
      }
      const remaining = currentIds.filter((sid) => !targets.includes(sid));
      setSelectedSegmentIds(remaining);
      selectedSegmentIdsRef.current = remaining;
      if (latestRes && isFullState(latestRes)) {
        const msg =
          targets.length > 1
            ? `已删除选中的 ${targets.length} 段标注。`
            : "已删除这段。";
        absorb({ ...latestRes, status_message: msg, message: msg });
      }
    },
    [absorb, pushUndoSnapshot],
  );

  const handleCopySegments = useCallback(() => {
    const validSet = new Set(stateRef.current.segments.map((s) => s.id));
    const ids = (
      selectedSegmentIdsRef.current.length > 0
        ? selectedSegmentIdsRef.current
        : stateRef.current.active_segment_id
          ? [stateRef.current.active_segment_id]
          : []
    ).filter((sid) => validSet.has(sid));

    const chosen = stateRef.current.segments
      .filter((s) => ids.includes(s.id))
      .sort(
        (a, b) =>
          a.start - b.start ||
          a.end - b.end ||
          (a.track_index ?? 0) - (b.track_index ?? 0),
      );
    if (chosen.length === 0) {
      setState((prev) => ({
        ...prev,
        status_message: "请先选中要复制的标注区间。",
      }));
      return;
    }
    clipboardRef.current = {
      items: chosen.map((s) => ({ ...s })),
      playhead: currentRef.current,
      trackIndex: stateRef.current.selected_track_index ?? 0,
    };
    setHasClipboard(true);
    setState((prev) => ({
      ...prev,
      status_message: `已复制 ${chosen.length} 段标注（按 Ctrl+V / ⌘V 粘贴）。`,
    }));
  }, []);

  const handlePasteSegments = useCallback(async () => {
    const clip = clipboardRef.current;
    if (!clip || clip.items.length === 0) {
      setState((prev) => ({
        ...prev,
        status_message: "剪贴板为空，请先按 Ctrl+C / ⌘C 复制标注。",
      }));
      return;
    }

    const st = stateRef.current;
    const tracks =
      st.list_animal && st.list_animal.length > 0
        ? st.list_animal
        : Array.from(new Set(st.labels.map((l) => l.animal)));
    const { baseStart, specs } = resolvePastePlan({
      clipboard: clip,
      currentPlayhead: currentRef.current,
      selectedTrackIndex: st.selected_track_index ?? 0,
      tracks,
      labels: st.labels,
      existingSegments: st.segments,
      fps: st.fps || 25,
    });

    pushUndoSnapshot();
    let latestRes: ApiResult | undefined;
    const newSelectedIds: string[] = [];

    for (const spec of specs) {
      const s = Math.round((baseStart + spec.offset) * 1000) / 1000;
      const e = Math.round((s + spec.duration) * 1000) / 1000;
      const currentSegments =
        latestRes && isFullState(latestRes)
          ? latestRes.segments
          : stateRef.current.segments;
      const beforeIds = new Set(currentSegments.map((seg) => seg.id));
      await call("select_action", spec.action);
      const startRes = await call("mark_start", s, spec.trackIndex, spec.action);
      if (!startRes.ok) {
        latestRes = startRes;
        break;
      }
      latestRes = await call("mark_end", e, spec.trackIndex, spec.action);
      if (latestRes && isFullState(latestRes)) {
        const created = latestRes.segments.find((seg) => !beforeIds.has(seg.id));
        if (created) {
          newSelectedIds.push(created.id);
        } else if (latestRes.active_segment_id) {
          newSelectedIds.push(latestRes.active_segment_id);
        }
      }
    }

    if (latestRes && !latestRes.ok) {
      absorb(latestRes);
      return;
    }
    if (latestRes && isFullState(latestRes)) {
      latestRes = await reconcileOverlappingSegments(
        latestRes,
        newSelectedIds[newSelectedIds.length - 1] ?? null,
      );
      const validIds = new Set(
        isFullState(latestRes) ? latestRes.segments.map((s) => s.id) : [],
      );
      const finalSelected = Array.from(new Set(newSelectedIds)).filter((id) =>
        validIds.has(id),
      );
      setSelectedSegmentIds(finalSelected);
      selectedSegmentIdsRef.current = finalSelected;
      const msg = `已粘贴 ${specs.length} 段标注。`;
      absorb({ ...latestRes, status_message: msg, message: msg });
    }
  }, [absorb, pushUndoSnapshot]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (navigatingRef.current || dialogRef.current || editingTarget(event.target)) return;
      if (
        inStudioField(event.target) &&
        (event.key === " " ||
          event.key === "Enter" ||
          event.key === "Escape" ||
          event.key === "Home" ||
          event.key === "End" ||
          event.key.startsWith("Arrow"))
      ) {
        return;
      }
      if (
        stateRef.current.view_mode === "cards" ||
        stateRef.current.mode === "evaluate"
      )
        return;
      const key = event.key.toLowerCase();
      if (event.metaKey || event.ctrlKey) {
        if (key === "s") {
          event.preventDefault();
          void saveCard();
        } else if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) void handleRedo();
          else void handleUndo();
        } else if (key === "y") {
          event.preventDefault();
          void handleRedo();
        } else if (key === "c") {
          const textSelection = window.getSelection()?.toString().trim();
          if (textSelection) return;
          event.preventDefault();
          handleCopySegments();
        } else if (key === "v") {
          event.preventDefault();
          void handlePasteSegments();
        }
        return;
      }
      if (event.altKey) return;
      if (event.key === " " || key === "k") {
        event.preventDefault();
        togglePlay();
        return;
      }
      if (key === "i") {
        event.preventDefault();
        handleMarkStart();
        return;
      }
      if (key === "o") {
        event.preventDefault();
        void handleMarkEnd();
        return;
      }
      if (key === "escape") {
        event.preventDefault();
        void run("cancel_pending");
        return;
      }
      if (key === "j") {
        event.preventDefault();
        stepSeconds(-1);
        return;
      }
      if (key === "l") {
        event.preventDefault();
        stepSeconds(1);
        return;
      }
      if (key === "m") {
        event.preventDefault();
        toggleMute();
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        if (event.shiftKey) stepSeconds(direction);
        else stepFrames(direction);
        return;
      }
      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        (selectedSegmentIdsRef.current.length > 0 ||
          stateRef.current.active_segment_id)
      ) {
        event.preventDefault();
        void handleDeleteSelectedSegments();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    handleCopySegments,
    handleDeleteSelectedSegments,
    handleMarkEnd,
    handleMarkStart,
    handlePasteSegments,
    handleRedo,
    handleUndo,
    run,
    saveCard,
    stepFrames,
    stepSeconds,
    toggleMute,
    togglePlay,
  ]);

  const updateSegment = useCallback(
    (id: string, start: number, end: number) => {
      pushUndoSnapshot();
      void run("update_segment", id, start, end, true);
    },
    [pushUndoSnapshot, run],
  );

  const handleSeekStatic = useCallback(
    (time: number) => {
      seekTo(time, false);
    },
    [seekTo],
  );

  const handleDeleteSegmentProp = useCallback(
    (id: string) => {
      void handleDeleteSelectedSegments(id);
    },
    [handleDeleteSelectedSegments],
  );

  const handleSelectSegmentProp = useCallback(
    (id: string, multi?: boolean) => {
      void handleSelectSegment(id, Boolean(multi));
    },
    [handleSelectSegment],
  );

  const onDropFiles = useCallback(
    async (files: FileList | File[]) => {
      for (const file of Array.from(files)) {
        const named = file as File & { path?: string };
        const lower = file.name.toLowerCase();
        const isArchive = [".zip", ".tar.gz", ".tgz", ".tar"].some((ext) =>
          lower.endsWith(ext),
        );
        const isVideo = [".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"].some(
          (ext) => lower.endsWith(ext),
        );
        if (isArchive || isVideo) {
          setState((prev) => ({
            ...prev,
            status_message: `正在导入 ${file.name} 到 datasets/ 目录…`,
          }));
          try {
            const dropRes = (await call(
              "import_dropped_file",
              file.name,
              file.size || 0,
              named.path || "",
            )) as ApiResult & { needs_upload?: boolean; upload_url?: string };
            if (dropRes.needs_upload && dropRes.upload_url) {
              const upResp = await fetch(dropRes.upload_url, {
                method: "POST",
                body: file,
              });
              const upJson = (await upResp.json()) as {
                ok?: boolean;
                path?: string;
              };
              if (upJson.ok && upJson.path) {
                if (isArchive) {
                  await run("import_dataset_zip", upJson.path, "");
                } else if (stateRef.current.view_mode === "cards") {
                  await run("add_video_to_dataset", upJson.path);
                } else {
                  await run("open_video_path", upJson.path);
                }
              }
            } else {
              absorb(dropRes);
            }
          } catch (error) {
            setState((prev) => ({
              ...prev,
              status_message:
                error instanceof Error ? error.message : "拖入文件导入失败。",
            }));
          }
        } else if (
          [".json", ".csv", ".txt"].some((ext) => lower.endsWith(ext))
        ) {
          await run("parse_text", await file.text(), "");
        }
      }
    },
    [absorb, run],
  );

  const animalTracks = useMemo(() => {
    if (state.list_animal && state.list_animal.length > 0) {
      return state.list_animal;
    }
    const seen: string[] = [];
    for (const item of state.labels) {
      if (!seen.includes(item.animal)) seen.push(item.animal);
    }
    return seen;
  }, [state.list_animal, state.labels]);

  const availableActions = useMemo(() => {
    if (state.available_actions && state.available_actions.length > 0) {
      return state.available_actions;
    }
    const seen: string[] = [];
    for (const item of state.labels) {
      if (!seen.includes(item.action)) seen.push(item.action);
    }
    return seen;
  }, [state.available_actions, state.labels]);

  const actionEntries = useMemo(() => {
    return availableActions.map((action) => {
      const animals = Array.from(
        new Set(
          state.labels.filter((l) => l.action === action).map((l) => l.animal),
        ),
      );
      const count = state.segments.filter(
        (seg) => seg.action === action,
      ).length;
      return { action, animals, count };
    });
  }, [availableActions, state.labels, state.segments]);

  const visibleActions = useMemo(() => {
    return actionEntries.filter((entry) => {
      if (labelFilter === "done") return entry.count > 0;
      if (labelFilter === "todo") return entry.count === 0;
      return true;
    });
  }, [actionEntries, labelFilter]);

  const timelineDuration = Math.max(
    mediaDuration,
    ...state.segments.map((segment) => segment.end),
    state.pending_time ?? 0,
    current,
    1,
  );
  const grounding = (
    state.grounding_result?.bonus_temporal_grounding.output
      .predicted_intervals ?? []
  ).map((interval) => ({
    start: interval.start,
    end: interval.end,
    iou: interval.iou_with_gt,
  }));

  const datasetItems = state.dataset_items ?? [];
  const isCardsView = (state.view_mode ?? "cards") === "cards";
  const showAnalytics =
    (isCardsView && cardsTab === "analytics") ||
    (!isCardsView && state.mode === "evaluate");

  useEffect(() => {
    localStorage.setItem(STUDIO_LAYOUT_KEY, JSON.stringify(layout));
  }, [layout]);

  useEffect(() => {
    const node = studioRef.current;
    if (!node || isCardsView || state.mode === "evaluate") return;
    const fit = () => {
      if (node.clientWidth < 100) return;
      setNarrowStudio(node.clientWidth < 760);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(node);
    fit();
    return () => observer.disconnect();
  }, [isCardsView, state.mode]);

  const inDatasetCard = Boolean(state.workspace_dir && state.active_card_id);
  const activeTrackIndex = state.selected_track_index ?? 0;
  const activeAction = state.selected_action || availableActions[0] || "";

  const frameTrackOverlayRows = useMemo(() => {
    const epsilon = 1e-4;
    return animalTracks.map((animalName, trackIndex) => {
      const activeActions: string[] = [];
      for (const seg of state.segments) {
        const segTrack =
          typeof seg.track_index === "number" ? seg.track_index : 0;
        if (segTrack !== trackIndex) continue;
        if (current >= seg.start - epsilon && current <= seg.end + epsilon) {
          if (seg.action && !activeActions.includes(seg.action)) {
            activeActions.push(seg.action);
          }
        }
      }
      return {
        trackIndex,
        animalName,
        activeActions,
        actionText: activeActions.join(", "),
      };
    });
  }, [animalTracks, state.segments, current]);

  return (
    <div
      data-theme={theme}
      className="studio-app flex h-full min-h-0 flex-col bg-studio text-ink"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (event.dataTransfer?.files?.length)
          void onDropFiles(event.dataTransfer.files);
      }}
    >
      {/* Unified Top Bar with Mode Tabs & Global Light/Dark Theme Switcher */}
      <header className="studio-header">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <StudioBreadcrumb
            isCardsView={isCardsView}
            datasetName={state.dataset_name || ""}
            videoName={state.video_name || ""}
            videoId={state.video_id || ""}
            videoMatched={state.video_matched !== false}
            onLeave={() => void run("leave_card", "check")}
          />
        </div>

        {isCardsView ? (
          <AnimatedTabs
            value={cardsTab}
            onChange={(id) => setCardsTab(id as "cards" | "analytics")}
            tabs={[
              { id: "cards", label: "样本库" },
              { id: "analytics", label: "行为洞察" },
            ]}
          />
        ) : (
          <AnimatedTabs
            value={state.mode}
            onChange={(id) => void run("set_mode", id)}
            tabs={[
              { id: "annotate", label: "行为工作台" },
              { id: "evaluate", label: "行为洞察" },
            ]}
          />
        )}

        <div className="studio-header-actions flex shrink-0 items-center justify-end gap-2">
          {isCardsView ? (
            <ThemeToggle theme={theme} onChange={setTheme} />
          ) : (
            <>
              {inDatasetCard && (
                <VideoNavigation position={state.active_card_position ?? -1}
                  total={state.dataset_total ?? datasetItems.length}
                  busy={navigating || savePhase === "saving"}
                  onNavigate={(direction) => void navigateVideo(direction)} />
              )}
              <ThemeToggle theme={theme} onChange={setTheme} />
              <select
                className="h-7 rounded-md border border-line bg-card/60 px-2 font-mono text-xs font-medium text-ink transition-colors hover:bg-card"
                value={state.fps}
                aria-label="帧率"
                onChange={(event) =>
                  void run("set_fps", Number(event.target.value))
                }
              >
                {[24, 25, 30, 60].map((fps) => (
                  <option key={fps} value={fps}>
                    {fps} fps
                  </option>
                ))}
              </select>
              <SaveButton
                phase={savePhase}
                dirty={Boolean(state.is_dirty)}
                inDataset={inDatasetCard}
                onSave={() => void saveCard()}
              />
              <OverflowMenu
                exportLabel={inDatasetCard ? "另存为..." : "导出 JSON"}
                onExport={() => void run("export_json", false, "")}
                onOpenLabels={() => void run("open_labels_dialog")}
                onOpenVideo={() => void run("open_video_dialog")}
                onToggleGuide={() => setShowGuide((prev) => !prev)}
                onResetLayout={() => setLayout({ ...DEFAULT_STUDIO_LAYOUT })}
              />
            </>
          )}
        </div>
      </header>

      {/* Persistent Behavior Insights View (Kept alive across tab switches so charts & filters never auto-reset) */}
      <div
        className={
          showAnalytics ? "flex min-h-0 flex-1 flex-col" : "hidden"
        }
      >
        <EvaluatePanels
          state={state}
          mediaDuration={mediaDuration}
          isActive={showAnalytics}
          onCall={run}
          onSeek={(time, play) => {
            if (!isCardsView) {
              void run("set_mode", "annotate");
            }
            seekTo(time, play);
          }}
        />
      </div>

      {/* Dataset Cards Library View */}
      {isCardsView && cardsTab === "cards" && (
        <DatasetCards
          datasetName={state.dataset_name || ""}
          workspaceDir={state.workspace_dir || ""}
          mediaBaseUrl={state.media_base_url || ""}
          availableDatasets={state.available_datasets ?? []}
          items={datasetItems}
          onSwitchDataset={(folderName) => void run("switch_dataset", folderName)}
          activeCardId={state.active_card_id || null}
          onImportZip={() => void run("import_dataset_zip", "", "")}
          onOpenFolder={() => void run("open_dataset_folder", "")}
          onAddSingleVideo={() => void run("add_video_to_dataset", "")}
          onLoadDemoDataset={() => void run("load_demo_dataset")}
          onOpenCard={(videoId) => {
            setCurrent(0);
            currentRef.current = 0;
            void run("open_card", videoId);
          }}
          onExportSelected={(videoIds, mode) =>
            void run("export_selected_cards", videoIds, mode, "")
          }
          onRemoveSelected={(videoIds) =>
            void run("remove_selected_cards", videoIds)
          }
        />
      )}

      {/* Annotation Studio Workspace */}
      {!isCardsView && state.mode === "annotate" && (
        <div
          id="studio-workspace"
          role="tabpanel"
          aria-labelledby={`mode-tab-${state.mode}`}
          className="studio-workspace flex min-h-0 flex-1 flex-col"
        >
          {state.mode === "annotate" && showGuide && (
            <div className="studio-guide">
              <span className="studio-guide-label">快速上手</span>
              <span>
                <b>1</b> 右侧选择行为
              </span>
              <span className="text-line">/</span>
              <span>
                <b>2</b> 下方选择动物轨道
              </span>
              <span className="text-line">/</span>
              <span>
                <b>3</b> 在轨道拖拽划段，或按 <kbd>I</kbd> 设起点、<kbd>O</kbd> 设终点
              </span>
              <button
                type="button"
                aria-label="隐藏标注引导"
                onClick={() => setShowGuide(false)}
              >
                收起 ×
              </button>
            </div>
          )}

          <div ref={studioRef} className="studio-stage flex min-h-0 flex-1">
            <SplitPane
              direction="column"
              size={layout.timelineHeight}
              minPrimary={140}
              minSecondary={360}
              onSizeChange={(timelineHeight) =>
                setLayout((prev) => ({ ...prev, timelineHeight }))
              }
              className="min-h-0 flex-1"
              start={
                <SplitPane
                  direction={narrowStudio ? "column" : "row"}
                  size={narrowStudio ? layout.stackedHeight : layout.sideWidth}
                  minPrimary={narrowStudio ? 220 : 300}
                  minSecondary={narrowStudio ? 180 : 320}
                  onSizeChange={(size) =>
                    setLayout((prev) => ({
                      ...prev,
                      ...(narrowStudio
                        ? { stackedHeight: size }
                        : { sideWidth: size }),
                    }))
                  }
                  className="h-full min-h-0 min-w-0"
                  start={
                    <main className="video-panel studio-surface flex h-full min-h-0 min-w-0 flex-1 flex-col">
                      <div
                        className={`relative min-h-0 flex-1 overflow-hidden bg-[#0A0C10] ${dragging ? "ring-2 ring-mark" : ""}`}
                      >
                        <FrameAnimalOverlay
                          rows={frameTrackOverlayRows}
                          availableActions={availableActions}
                          visible={showFrameOverlay}
                          onToggleVisible={setShowFrameOverlay}
                        />
                        {state.video_url ? (
                          <>
                            <video
                              ref={videoRef}
                              className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
                              src={state.video_url}
                              preload="auto"
                              onTimeUpdate={() => {
                                const video = videoRef.current;
                                if (
                                  !video ||
                                  video.seeking ||
                                  pendingSeekRef.current !== null
                                )
                                  return;
                                const t = video.currentTime || 0;
                                currentRef.current = t;
                                const audio = audioRef.current;
                                if (
                                  audio &&
                                  hasSeparateAudio &&
                                  !video.paused &&
                                  Math.abs((audio.currentTime || 0) - t) > 0.12
                                ) {
                                  audio.currentTime = t;
                                }
                                const now = performance.now();
                                if (video.paused || now - lastTimeUiUpdateMsRef.current >= 55) {
                                  lastTimeUiUpdateMsRef.current = now;
                                  setCurrent(t);
                                }
                              }}
                              onSeeked={onVideoSeeked}
                              onLoadedMetadata={() => {
                                const video = videoRef.current;
                                if (video) {
                                  video.muted = hasSeparateAudio ? true : muted;
                                  video.volume = Math.max(0, Math.min(1, volume));
                                  setMediaDuration(video.duration || 0);
                                } else {
                                  setMediaDuration(0);
                                }
                              }}
                              onPlay={() => {
                                setPlaying(true);
                                const audio = audioRef.current;
                                const video = videoRef.current;
                                if (audio && hasSeparateAudio && video) {
                                  audio.currentTime = video.currentTime || 0;
                                  audio.muted = muted;
                                  audio.volume = Math.max(0, Math.min(1, volume));
                                  void audio.play().catch(() => undefined);
                                }
                              }}
                              onPause={() => {
                                setPlaying(false);
                                audioRef.current?.pause();
                                if (videoRef.current) setCurrent(videoRef.current.currentTime || 0);
                              }}
                              onEnded={() => {
                                setPlaying(false);
                                audioRef.current?.pause();
                                if (videoRef.current) setCurrent(videoRef.current.currentTime || 0);
                              }}
                            />
                            <audio
                              ref={audioRef}
                              src={`${state.video_url}.mp3`}
                              preload="auto"
                              className="hidden"
                              onLoadedMetadata={() => {
                                const audio = audioRef.current;
                                const video = videoRef.current;
                                if (audio && audio.duration > 0) {
                                  setHasSeparateAudio(true);
                                  audio.muted = muted;
                                  audio.volume = Math.max(0, Math.min(1, volume));
                                  if (video) {
                                    video.muted = true;
                                    audio.currentTime = video.currentTime || 0;
                                    if (!video.paused) {
                                      void audio.play().catch(() => undefined);
                                    }
                                  }
                                }
                              }}
                              onError={() => setHasSeparateAudio(false)}
                            />
                          </>
                        ) : (
                          <div className="drop-grid grid h-full place-items-center p-6 text-center text-sm text-mute">
                            <div className="w-full max-w-md rounded-xl border border-dashed border-line bg-panel p-6">
                              <Upload
                                size={20}
                                className="mx-auto mb-2 text-mark"
                              />
                              <p className="text-xs font-medium text-ink">
                                当前卡片尚未绑定视频画面
                              </p>
                              <div className="mt-4 flex justify-center gap-2">
                                <button
                                  type="button"
                                  className="studio-button"
                                  onClick={() => void run("open_video_dialog")}
                                >
                                  选择本地视频
                                </button>
                                <button
                                  type="button"
                                  className="rounded-md bg-mark px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                                  onClick={() => void run("load_demo", false)}
                                >
                                  加载示例视频
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <PlaybackToolbar
                        current={current}
                        duration={mediaDuration}
                        fps={state.fps || 25}
                        status={state.status_message}
                        playing={playing}
                        muted={muted}
                        volume={volume}
                        pendingTime={state.pending_time}
                        activeSegmentId={state.active_segment_id}
                        selectedCount={selectedSegmentIds.length}
                        canUndo={historyState.canUndo}
                        canRedo={historyState.canRedo}
                        showFrameOverlay={showFrameOverlay}
                        onToggleFrameOverlay={() =>
                          setShowFrameOverlay((prev) => !prev)
                        }
                        onTogglePlay={togglePlay}
                        onToggleMute={toggleMute}
                        onVolumeChange={handleVolumeChange}
                        onStepFrames={stepFrames}
                        onStepSeconds={stepSeconds}
                        onMarkStart={handleMarkStart}
                        onMarkEnd={() => void handleMarkEnd()}
                        onCancel={() => void run("cancel_pending")}
                        onDelete={() => void handleDeleteSelectedSegments()}
                        onUndo={() => void handleUndo()}
                        onRedo={() => void handleRedo()}
                      />
                    </main>
                  }
                  end={
                    <aside className="studio-inspector studio-surface flex h-full min-h-0 min-w-0 flex-col bg-panel">
                      <SplitPane
                        direction={narrowStudio ? "row" : "column"}
                        size={
                          narrowStudio
                            ? layout.stackedInspectorWidth
                            : layout.inspectorHeight
                        }
                        minPrimary={narrowStudio ? 260 : 140}
                        minSecondary={narrowStudio ? 260 : 210}
                        onSizeChange={(size) =>
                          setLayout((prev) => ({
                            ...prev,
                            ...(narrowStudio
                              ? { stackedInspectorWidth: size }
                              : { inspectorHeight: size }),
                          }))
                        }
                        className="h-full"
                        start={
                          <BehaviorInspector
                            entries={visibleActions}
                            orderedActions={availableActions}
                            selectedAction={state.selected_action}
                            pendingTime={state.pending_time}
                            filter={labelFilter}
                            onFilterChange={setLabelFilter}
                            onSelectAction={(action) =>
                              void run("select_action", action)
                            }
                            onOpenLabels={() =>
                              void run("reveal_json_path")
                            }
                            onOpenVideo={() => void run("reveal_video_path")}
                          />
                        }
                        end={
                          <SegmentList
                            segments={state.segments}
                            orderedActions={availableActions}
                            fps={state.fps || 25}
                            activeId={state.active_segment_id}
                            selectedIds={selectedSegmentIds}
                            onSeek={handleSeekStatic}
                            onDelete={handleDeleteSegmentProp}
                            onUpdate={updateSegment}
                            onSelect={handleSelectSegmentProp}
                          />
                        }
                      />
                    </aside>
                  }
                />
              }
              end={
                <Timeline
                  listAnimal={animalTracks}
                  availableActions={availableActions}
                  labels={state.labels}
                  segments={state.segments}
                  comparisons={state.qc_report?.segment_comparisons ?? []}
                  grounding={grounding}
                  current={current}
                  duration={timelineDuration}
                  selectedKey={state.selected_key}
                  selectedTrackIndex={activeTrackIndex}
                  selectedAction={activeAction}
                  pendingKey={state.pending_key}
                  pendingTrackIndex={state.pending_track_index ?? null}
                  pendingAction={state.pending_action ?? null}
                  pendingTime={state.pending_time}
                  activeId={state.active_segment_id}
                  selectedIds={selectedSegmentIds}
                  doneCount={state.done_count}
                  labelCount={state.label_count}
                  fps={state.fps || 25}
                  onSeek={seekTo}
                  onSelectLabel={(animal, action) =>
                    void run("select_label", animal, action)
                  }
                  onSelectTrack={(trackIndex) =>
                    void run("select_track", trackIndex)
                  }
                  onSelectSegment={(id, multi) =>
                    void handleSelectSegment(id, Boolean(multi))
                  }
                  onDeselectSegment={() => void handleDeselectSegment()}
                  onDeleteSegment={(id) => void handleDeleteSelectedSegments(id)}
                  onCopySegments={handleCopySegments}
                  onPasteSegments={() => void handlePasteSegments()}
                  canPaste={hasClipboard}
                  onUpdateSegment={updateSegment}
                  onChangeSegmentAction={(id, action) => void changeSegmentAction(id, action)}
                  onCreateSegment={(animal, action, start, end, trackIndex) =>
                    void handleCreateSegment(
                      animal,
                      action,
                      start,
                      end,
                      trackIndex,
                    )
                  }
                />
              }
            />
          </div>
        </div>
      )}

      {navigating && (
        <div className="fixed inset-0 z-[60] grid cursor-wait place-items-center bg-black/10" role="status" aria-live="polite">
          <div className="rounded-lg border border-line bg-panel px-5 py-3 text-sm shadow-xl">正在保存并切换视频…</div>
        </div>
      )}
      {dialog && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-6 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-xl border border-line bg-panel p-5 shadow-2xl">
            <h2 className="text-base font-semibold text-ink">
              {dialog.kind === "leave_dirty_card"
                ? "是否保存当前卡片修改？"
                : "请确认"}
            </h2>
            <p className="mt-2 text-xs leading-5 text-mute">{dialog.message}</p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-mute hover:bg-card hover:text-ink"
                onClick={() => setDialog(null)}
              >
                取消
              </button>
              {dialog.kind === "leave_dirty_card" && (
                <button
                  type="button"
                  className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-500/20"
                  onClick={() => {
                    setDialog(null);
                    void run("leave_card", "discard_and_leave");
                  }}
                >
                  不保存直接退出
                </button>
              )}
              {dialog.kind === "merge_or_replace" && (
                <button
                  type="button"
                  className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-card"
                  onClick={() => {
                    const text = dialog.text;
                    setDialog(null);
                    void run("parse_text", text, "merge");
                  }}
                >
                  合并新增
                </button>
              )}
              <button
                type="button"
                className="rounded-md bg-mark px-3 py-1.5 text-xs font-semibold text-white hover:brightness-110"
                onClick={() => {
                  const currentDialog = dialog;
                  setDialog(null);
                  if (currentDialog.kind === "demo")
                    void run("load_demo", true);
                  if (currentDialog.kind === "empty")
                    void run("export_json", true, "");
                  if (currentDialog.kind === "restore")
                    void run("restore_autosave", currentDialog.path);
                  if (currentDialog.kind === "leave_dirty_card")
                    void run("leave_card", "save_and_leave");
                  if (
                    currentDialog.kind === "replace_project" ||
                    currentDialog.kind === "merge_or_replace"
                  ) {
                    void run("parse_text", currentDialog.text, "replace");
                  }
                }}
              >
                {dialog.kind === "leave_dirty_card" ? "保存并退出" : "继续"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
