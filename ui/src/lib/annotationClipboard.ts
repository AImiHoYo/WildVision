import { call } from "../bridge";
import {
  isFullState,
  type ApiResult,
  type LabelItem,
  type SegmentItem,
} from "../types";

export type ClipboardSnapshot = {
  items: SegmentItem[];
  playhead: number;
  trackIndex: number;
};

export type ResolvedPasteSpec = {
  trackIndex: number;
  animal: string;
  action: string;
  offset: number;
  duration: number;
};

export function resolvePastePlan(params: {
  clipboard: ClipboardSnapshot;
  currentPlayhead: number;
  selectedTrackIndex: number;
  tracks: string[];
  labels: LabelItem[];
  existingSegments: SegmentItem[];
  fps: number;
}): {
  specs: ResolvedPasteSpec[];
  baseStart: number;
} {
  const {
    clipboard,
    currentPlayhead,
    selectedTrackIndex,
    tracks,
    labels,
    existingSegments,
    fps,
  } = params;
  const minStart = Math.min(...clipboard.items.map((s) => s.start));
  const playheadMoved = Math.abs(currentPlayhead - clipboard.playhead) > 1e-3;
  const isMulti = clipboard.items.length > 1;
  const trackChanged = !isMulti && selectedTrackIndex !== clipboard.trackIndex;

  const pairAllowed = (animal: string, action: string) =>
    labels.some((l) => l.animal === animal && l.action === action);

  const specs: ResolvedPasteSpec[] = clipboard.items.map((item) => {
    const origTrack =
      typeof item.track_index === "number" ? item.track_index : 0;
    let chosenTrack = origTrack;
    let chosenAnimal = tracks[origTrack] || item.animal;

    if (
      !isMulti &&
      trackChanged &&
      !playheadMoved &&
      tracks[selectedTrackIndex] &&
      pairAllowed(tracks[selectedTrackIndex], item.action)
    ) {
      chosenTrack = selectedTrackIndex;
      chosenAnimal = tracks[selectedTrackIndex];
    } else if (
      tracks[origTrack] &&
      pairAllowed(tracks[origTrack], item.action)
    ) {
      chosenTrack = origTrack;
      chosenAnimal = tracks[origTrack];
    } else {
      const fallbackIdx = tracks.findIndex((name) =>
        pairAllowed(name, item.action),
      );
      if (fallbackIdx >= 0) {
        chosenTrack = fallbackIdx;
        chosenAnimal = tracks[fallbackIdx];
      }
    }
    return {
      trackIndex: chosenTrack,
      animal: chosenAnimal,
      action: item.action,
      offset: Math.max(0, item.start - minStart),
      duration: Math.max(0.04, item.end - item.start),
    };
  });

  let baseStart = playheadMoved
    ? Math.max(0, currentPlayhead)
    : trackChanged
      ? minStart
      : Math.max(0, currentPlayhead);

  if (!playheadMoved && !trackChanged) {
    const safeFps = fps > 0 ? fps : 25;
    const stepGap = Math.max(0.04, 1 / safeFps);
    for (let attempt = 0; attempt < 50; attempt += 1) {
      let conflictEnd: number | null = null;
      for (const spec of specs) {
        const candS = baseStart + spec.offset;
        const candE = candS + spec.duration;
        for (const existing of existingSegments) {
          const exTrack =
            typeof existing.track_index === "number" ? existing.track_index : 0;
          if (
            exTrack === spec.trackIndex &&
            existing.action === spec.action &&
            candS <= existing.end + 1e-4 &&
            candE >= existing.start - 1e-4
          ) {
            conflictEnd =
              conflictEnd === null
                ? existing.end
                : Math.max(conflictEnd, existing.end);
          }
        }
      }
      if (conflictEnd === null) break;
      baseStart = Math.round((conflictEnd + stepGap) * 1000) / 1000;
    }
  }

  return { specs, baseStart };
}

export async function reconcileOverlappingSegments(
  result: ApiResult,
  preferredId?: string | null,
): Promise<ApiResult> {
  if (!result.ok || !isFullState(result) || !Array.isArray(result.segments)) {
    return result;
  }
  const groups = new Map<string, SegmentItem[]>();
  for (const seg of result.segments) {
    const trackIdx = typeof seg.track_index === "number" ? seg.track_index : 0;
    const key = `${trackIdx}:::${seg.animal}:::${seg.action}`;
    const list = groups.get(key);
    if (list) list.push(seg);
    else groups.set(key, [seg]);
  }

  let latestResult: ApiResult = result;
  let didMerge = false;
  let finalSelectedId: string | null =
    preferredId ?? result.active_segment_id ?? null;
  const epsilon = 1e-4;

  for (const list of groups.values()) {
    if (list.length <= 1) continue;
    const sorted = list
      .slice()
      .sort((a, b) => a.start - b.start || a.end - b.end);
    let i = 0;
    while (i < sorted.length) {
      const cluster: SegmentItem[] = [sorted[i]];
      let clusterEnd = sorted[i].end;
      let j = i + 1;
      while (j < sorted.length && sorted[j].start <= clusterEnd + epsilon) {
        cluster.push(sorted[j]);
        clusterEnd = Math.max(clusterEnd, sorted[j].end);
        j += 1;
      }
      if (cluster.length > 1) {
        didMerge = true;
        const kept = cluster[0];
        const mergedStart = Math.min(...cluster.map((s) => s.start));
        const mergedEnd = Math.max(...cluster.map((s) => s.end));
        if (
          Math.abs(kept.start - mergedStart) > 1e-6 ||
          Math.abs(kept.end - mergedEnd) > 1e-6
        ) {
          latestResult = await call(
            "update_segment",
            kept.id,
            mergedStart,
            mergedEnd,
            false,
          );
        }
        for (let k = 1; k < cluster.length; k += 1) {
          if (finalSelectedId === cluster[k].id) {
            finalSelectedId = kept.id;
          }
          latestResult = await call("delete_segment", cluster[k].id);
        }
      }
      i = j;
    }
  }

  if (didMerge && finalSelectedId) {
    const selRes = await call("select_segment", finalSelectedId);
    if (selRes.ok && isFullState(selRes)) {
      latestResult = {
        ...selRes,
        status_message: "已将同动物同行为的重叠区间自动合并。",
      };
    }
  }
  return latestResult;
}
