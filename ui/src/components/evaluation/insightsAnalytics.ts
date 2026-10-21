import {
  type DatasetCardItem,
  type DesktopState,
  type SegmentItem,
} from "../../types";

export type HeroChartMode = "rose" | "mosaic";

export type VirtualCard = {
  video_id: string;
  video_name: string;
  video_relpath: string;
  fps: number;
  estDuration: number;
  list_animal: string[];
  list_animal_action: [string, string][];
  segments: SegmentItem[];
  status: string;
  segment_count?: number;
  done_count: number;
  label_count: number;
  isSample?: boolean;
};

export const SAMPLE_REFERENCE_CARDS: VirtualCard[] = [
  {
    video_id: "AK_SNAKE_01",
    video_name: "AK_SNAKE_01.mp4",
    video_relpath: "videos/AK_SNAKE_01.mp4",
    fps: 25,
    estDuration: 16.0,
    list_animal: ["Snake", "Snake"],
    list_animal_action: [
      ["Snake", "Sensing"],
      ["Snake", "Moving"],
      ["Snake", "Eating"],
    ],
    status: "completed",
    done_count: 3,
    label_count: 3,
    isSample: true,
    segment_count: 5,
    segments: [
      { id: "ref-1", animal: "Snake", action: "Sensing", start: 0.2, end: 6.8, track_index: 0 },
      { id: "ref-2", animal: "Snake", action: "Sensing", start: 8.4, end: 14.9, track_index: 0 },
      { id: "ref-3", animal: "Snake", action: "Moving", start: 6.8, end: 8.4, track_index: 0 },
      { id: "ref-4", animal: "Snake", action: "Eating", start: 3.2, end: 4.1, track_index: 1 },
      { id: "ref-5", animal: "Snake", action: "Sensing", start: 4.2, end: 11.5, track_index: 1 },
    ],
  },
  {
    video_id: "AK_SNAKE_02",
    video_name: "AK_SNAKE_02.mp4",
    video_relpath: "videos/AK_SNAKE_02.mp4",
    fps: 25,
    estDuration: 12.0,
    list_animal: ["Snake"],
    list_animal_action: [
      ["Snake", "Sensing"],
      ["Snake", "Moving"],
      ["Snake", "Eating"],
    ],
    status: "completed",
    done_count: 3,
    label_count: 3,
    isSample: true,
    segment_count: 4,
    segments: [
      { id: "ref-6", animal: "Snake", action: "Sensing", start: 0.0, end: 5.6, track_index: 0 },
      { id: "ref-7", animal: "Snake", action: "Eating", start: 5.7, end: 6.4, track_index: 0 },
      { id: "ref-8", animal: "Snake", action: "Moving", start: 6.5, end: 9.2, track_index: 0 },
      { id: "ref-9", animal: "Snake", action: "Eating", start: 9.3, end: 9.9, track_index: 0 },
    ],
  },
  {
    video_id: "AAACXZTV",
    video_name: "AAACXZTV.mp4",
    video_relpath: "videos/AAACXZTV.mp4",
    fps: 25,
    estDuration: 12.0,
    list_animal: ["Common Crane", "Common Crane"],
    list_animal_action: [
      ["Common Crane", "Attending"],
      ["Common Crane", "Eating"],
    ],
    status: "completed",
    done_count: 2,
    label_count: 2,
    isSample: true,
    segment_count: 4,
    segments: [
      { id: "ref-10", animal: "Common Crane", action: "Attending", start: 0.0, end: 3.6, track_index: 0 },
      { id: "ref-11", animal: "Common Crane", action: "Eating", start: 4.0, end: 8.2, track_index: 0 },
      { id: "ref-12", animal: "Common Crane", action: "Attending", start: 1.2, end: 6.0, track_index: 1 },
      { id: "ref-13", animal: "Common Crane", action: "Eating", start: 7.5, end: 10.8, track_index: 1 },
    ],
  },
  {
    video_id: "AABCQPTK",
    video_name: "AABCQPTK.mp4",
    video_relpath: "videos/AABCQPTK.mp4",
    fps: 25,
    estDuration: 10.0,
    list_animal: ["Singing Nightingale", "Singing Nightingale"],
    list_animal_action: [
      ["Singing Nightingale", "Attending"],
      ["Singing Nightingale", "Chirping"],
    ],
    status: "in_progress",
    done_count: 2,
    label_count: 2,
    isSample: true,
    segment_count: 4,
    segments: [
      { id: "ref-14", animal: "Singing Nightingale", action: "Chirping", start: 0.5, end: 1.3, track_index: 0 },
      { id: "ref-15", animal: "Singing Nightingale", action: "Attending", start: 1.5, end: 5.8, track_index: 0 },
      { id: "ref-16", animal: "Singing Nightingale", action: "Chirping", start: 6.1, end: 6.9, track_index: 0 },
      { id: "ref-17", animal: "Singing Nightingale", action: "Chirping", start: 2.0, end: 2.7, track_index: 1 },
    ],
  },
];

export function formatTimeHMS(date: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function getCardSpeciesSet(card: VirtualCard): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < card.list_animal.length; i += 1) {
    const sp = (card.list_animal[i] || "").trim();
    if (sp) set.add(sp);
  }
  for (let i = 0; i < card.list_animal_action.length; i += 1) {
    const sp = (card.list_animal_action[i]?.[0] || "").trim();
    if (sp) set.add(sp);
  }
  for (let i = 0; i < card.segments.length; i += 1) {
    const sp = (card.segments[i]?.animal || "").trim();
    if (sp) set.add(sp);
  }
  return set;
}

export function buildSelectionSignature(useSampleData: boolean, cards: VirtualCard[]): string {
  let segSum = 0;
  let firstId = "";
  let lastId = "";
  for (let i = 0; i < cards.length; i += 1) {
    segSum += cards[i].segments.length;
    if (i === 0) firstId = cards[i].video_id;
    if (i === cards.length - 1) lastId = cards[i].video_id;
  }
  const sampleIds =
    cards.length <= 80
      ? cards.map((c) => c.video_id).join(",")
      : `${cards.length}:${firstId}:${lastId}`;
  return `${useSampleData ? "sample" : "real"}|${sampleIds}|${segSum}`;
}

export function buildVirtualCards(state: DesktopState, mediaDuration = 12): VirtualCard[] {
  const items: DatasetCardItem[] = state.dataset_items ?? [];
  if (items.length > 0) {
    const res = new Array<VirtualCard>(items.length);
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const isCurrent = Boolean(state.active_card_id && item.video_id === state.active_card_id);
      const segs = isCurrent ? state.segments : (item.segments ?? []);
      let maxSegEnd = 0;
      for (let j = 0; j < segs.length; j += 1) {
        if (segs[j].end > maxSegEnd) maxSegEnd = segs[j].end;
      }
      const estDuration = Math.max(
        isCurrent && mediaDuration > 0 ? mediaDuration : 12,
        maxSegEnd,
        10,
      );
      res[i] = {
        video_id: item.video_id,
        video_name: item.video_name || `${item.video_id}.mp4`,
        video_relpath: item.video_relpath || `videos/${item.video_name || `${item.video_id}.mp4`}`,
        fps: item.fps || 25,
        estDuration,
        list_animal: item.list_animal ?? [],
        list_animal_action: item.list_animal_action ?? [],
        segments: segs,
        status: item.status || (segs.length > 0 ? "in_progress" : "unstarted"),
        segment_count: item.segment_count ?? segs.length,
        done_count: item.done_count ?? 0,
        label_count: item.label_count ?? (item.list_animal_action?.length || 0),
      };
    }
    return res;
  }

  const maxSegEnd = state.segments.reduce((m, s) => Math.max(m, s.end), 0);
  const pairs: [string, string][] =
    state.list_animal_action && state.list_animal_action.length > 0
      ? state.list_animal_action
      : state.labels.map((l) => [l.animal, l.action]);
  return [
    {
      video_id: state.video_id || "CURRENT",
      video_name: state.video_name || "当前视频",
      video_relpath: state.video_name ? `videos/${state.video_name}` : "videos/CURRENT.mp4",
      fps: state.fps || 25,
      estDuration: Math.max(mediaDuration || 12, maxSegEnd, 10),
      list_animal:
        state.list_animal && state.list_animal.length > 0
          ? state.list_animal
          : Array.from(new Set(state.labels.map((l) => l.animal))),
      list_animal_action: pairs,
      segments: state.segments,
      status:
        state.segments.length === 0
          ? "unstarted"
          : state.done_count >= state.label_count && state.label_count > 0
            ? "completed"
            : "in_progress",
      segment_count: state.segments.length,
      done_count: state.done_count,
      label_count: state.label_count,
    },
  ];
}

export type ActionStatItem = {
  action: string;
  duration: number;
  count: number;
  durationPct: number;
  countPct: number;
  avgDur: number;
};

export type MosaicColItem = {
  species: string;
  totalDuration: number;
  totalClips: number;
  blocks: {
    action: string;
    duration: number;
    count: number;
    sharePct: number;
  }[];
};

export type InsightsSnapshot = {
  orderedActions: string[];
  speciesNames: string[];
  totalVideos: number;
  completedVideos: number;
  totalTargetPairs: number;
  totalDonePairs: number;
  totalSegments: number;
  totalDurationSec: number;
  actionStats: ActionStatItem[];
  rosePlotItems: ActionStatItem[];
  mosaicColumns: MosaicColItem[];
  mosaicTotalDur: number;
  minDur: number;
  maxDur: number;
  medianDur: number;
  meanDur: number;
  stdDur: number;
  buckets: { id: string; label: string; sub: string; count: number; pct: number }[];
  perActionIntervals: { action: string; mean: number; std: number; min: number; max: number; count: number }[];
  densityBins: { label: string; pct: number; raw: number }[];
  foregroundRatio: number;
  overlapRatio: number;
};

export const MAX_ROSE_SECTORS = 8;
const MAX_MOSAIC_COLS = 6;

export function computeInsightsSnapshot(activeCards: VirtualCard[]): InsightsSnapshot {
  const totalVideos = activeCards.length;
  let completedVideos = 0;
  let totalTargetPairs = 0;
  let totalDonePairs = 0;
  let totalDurationSec = 0;
  let totalSegments = 0;

  const actionSet = new Set<string>();
  const speciesSet = new Set<string>();
  const speciesSegMap = new Map<string, Map<string, { duration: number; count: number }>>();
  const speciesTotalDurMap = new Map<string, { dur: number; clips: number }>();
  const actionAgg = new Map<string, { dur: number; count: number }>();
  const actionDurationsMap = new Map<string, number[]>();
  const durations: number[] = [];

  const bins = new Array<number>(10).fill(0);
  let totalVideoSpan = 0;
  let totalFgSpan = 0;
  let totalOverlapSpan = 0;

  for (let i = 0; i < activeCards.length; i += 1) {
    const card = activeCards[i];
    if (card.status === "completed") completedVideos += 1;
    totalTargetPairs += card.label_count || 0;
    totalDonePairs += card.done_count || 0;

    for (let j = 0; j < card.list_animal.length; j += 1) {
      const sp = (card.list_animal[j] || "").trim();
      if (sp) speciesSet.add(sp);
    }

    for (let j = 0; j < card.list_animal_action.length; j += 1) {
      const pair = card.list_animal_action[j];
      const sp = (pair?.[0] || "").trim();
      const act = (pair?.[1] || "").trim();
      if (sp) {
        speciesSet.add(sp);
        if (act) {
          actionSet.add(act);
          if (!actionAgg.has(act)) {
            actionAgg.set(act, { dur: 0, count: 0 });
          }
          let spActMap = speciesSegMap.get(sp);
          if (!spActMap) {
            spActMap = new Map();
            speciesSegMap.set(sp, spActMap);
          }
          if (!spActMap.has(act)) {
            spActMap.set(act, { duration: 0, count: 0 });
          }
        }
      }
    }

    const cardSegs = card.segments;
    for (let j = 0; j < cardSegs.length; j += 1) {
      const seg = cardSegs[j];
      if (seg.end > seg.start) {
        const d = seg.end - seg.start;
        const clampedDur = Math.max(0.04, d);
        totalSegments += 1;
        totalDurationSec += d;
        durations.push(clampedDur);

        if (seg.animal) {
          speciesSet.add(seg.animal);
          const spTot = speciesTotalDurMap.get(seg.animal) || { dur: 0, clips: 0 };
          spTot.dur += d;
          spTot.clips += 1;
          speciesTotalDurMap.set(seg.animal, spTot);

          let spActMap = speciesSegMap.get(seg.animal);
          if (!spActMap) {
            spActMap = new Map();
            speciesSegMap.set(seg.animal, spActMap);
          }
          const curSpAct = spActMap.get(seg.action) || { duration: 0, count: 0 };
          curSpAct.duration += d;
          curSpAct.count += 1;
          spActMap.set(seg.action, curSpAct);
        }

        if (seg.action) {
          actionSet.add(seg.action);
          const curAct = actionAgg.get(seg.action) || { dur: 0, count: 0 };
          curAct.dur += d;
          curAct.count += 1;
          actionAgg.set(seg.action, curAct);

          let actDurs = actionDurationsMap.get(seg.action);
          if (!actDurs) {
            actDurs = [];
            actionDurationsMap.set(seg.action, actDurs);
          }
          actDurs.push(clampedDur);
        }
      }
    }

    const dur = Math.max(card.estDuration, 1);
    totalVideoSpan += dur;
    if (cardSegs.length > 0) {
      const steps = 20;
      const dt = dur / steps;
      for (let s = 0; s < steps; s += 1) {
        const t = (s + 0.5) * dt;
        let activeCount = 0;
        let firstTrack = -999;
        let multiTrack = false;
        for (let k = 0; k < cardSegs.length; k += 1) {
          const seg = cardSegs[k];
          if (seg.start <= t && seg.end >= t) {
            activeCount += 1;
            const tr = seg.track_index ?? 0;
            if (firstTrack === -999) firstTrack = tr;
            else if (firstTrack !== tr) multiTrack = true;
          }
        }
        if (activeCount > 0) {
          totalFgSpan += dt;
          bins[Math.min(9, Math.floor((s / steps) * 10))] += 1;
        }
        if (multiTrack) totalOverlapSpan += dt;
      }
    }
  }

  const orderedActions = Array.from(actionSet);
  const speciesNames = Array.from(speciesSet);

  const actionStats: ActionStatItem[] = Array.from(actionAgg.entries())
    .map(([action, info]) => ({
      action,
      duration: info.dur,
      count: info.count,
      durationPct: totalDurationSec > 0 ? (info.dur / totalDurationSec) * 100 : 0,
      countPct: totalSegments > 0 ? (info.count / totalSegments) * 100 : 0,
      avgDur: info.count > 0 ? info.dur / info.count : 0,
    }))
    .sort((a, b) => b.duration - a.duration || b.count - a.count);

  let rosePlotItems = actionStats;
  if (actionStats.length > MAX_ROSE_SECTORS) {
    const top = actionStats.slice(0, MAX_ROSE_SECTORS - 1);
    const tail = actionStats.slice(MAX_ROSE_SECTORS - 1);
    const tailDur = tail.reduce((s, x) => s + x.duration, 0);
    const tailCount = tail.reduce((s, x) => s + x.count, 0);
    rosePlotItems = [
      ...top,
      {
        action: `其他 (${tail.length}项)`,
        duration: tailDur,
        count: tailCount,
        durationPct: totalDurationSec > 0 ? (tailDur / totalDurationSec) * 100 : 0,
        countPct: totalSegments > 0 ? (tailCount / totalSegments) * 100 : 0,
        avgDur: tailCount > 0 ? tailDur / tailCount : 0,
      },
    ];
  }

  const rawMosaicCols: MosaicColItem[] = speciesNames
    .map((sp) => {
      const spTot = speciesTotalDurMap.get(sp) || { dur: 0, clips: 0 };
      const spActMap = speciesSegMap.get(sp) || new Map();
      const blocks = Array.from(spActMap.entries())
        .map(([action, info]) => ({
          action,
          duration: info.duration,
          count: info.count,
          sharePct: spTot.dur > 0 ? (info.duration / spTot.dur) * 100 : 0,
        }))
        .sort((a, b) => b.duration - a.duration);
      return {
        species: sp,
        totalDuration: spTot.dur,
        totalClips: spTot.clips,
        blocks: blocks.slice(0, 6),
      };
    })
    .sort((a, b) => b.totalDuration - a.totalDuration);

  let mosaicColumns = rawMosaicCols;
  if (rawMosaicCols.length > MAX_MOSAIC_COLS) {
    const topCols = rawMosaicCols.slice(0, MAX_MOSAIC_COLS - 1);
    const restCols = rawMosaicCols.slice(MAX_MOSAIC_COLS - 1);
    const restDur = restCols.reduce((s, c) => s + c.totalDuration, 0);
    const restClips = restCols.reduce((s, c) => s + c.totalClips, 0);
    const mergedBlocksMap = new Map<string, { duration: number; count: number }>();
    for (const col of restCols) {
      for (const b of col.blocks) {
        const cur = mergedBlocksMap.get(b.action) || { duration: 0, count: 0 };
        cur.duration += b.duration;
        cur.count += b.count;
        mergedBlocksMap.set(b.action, cur);
      }
    }
    const mergedBlocks = Array.from(mergedBlocksMap.entries())
      .map(([action, info]) => ({
        action,
        duration: info.duration,
        count: info.count,
        sharePct: restDur > 0 ? (info.duration / restDur) * 100 : 0,
      }))
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5);
    mosaicColumns = [
      ...topCols,
      {
        species: `其他物种 (${restCols.length})`,
        totalDuration: restDur,
        totalClips: restClips,
        blocks: mergedBlocks,
      },
    ];
  }
  const mosaicTotalDur = mosaicColumns.reduce((s, c) => s + c.totalDuration, 0);

  durations.sort((a, b) => a - b);
  const n = durations.length;
  const minDur = n > 0 ? durations[0] : 0;
  const maxDur = n > 0 ? durations[n - 1] : 0;
  const medianDur =
    n > 0
      ? n % 2 === 1
        ? durations[(n - 1) / 2]
        : (durations[n / 2 - 1] + durations[n / 2]) / 2
      : 0;
  let sumDur = 0;
  for (let i = 0; i < n; i += 1) sumDur += durations[i];
  const meanDur = n > 0 ? sumDur / n : 0;
  let sqDiff = 0;
  for (let i = 0; i < n; i += 1) {
    const diff = durations[i] - meanDur;
    sqDiff += diff * diff;
  }
  const stdDur = n > 1 ? Math.sqrt(sqDiff / n) : 0;

  const buckets = [
    { id: "b1", label: "< 1.0s", sub: "<25f", count: 0, pct: 0 },
    { id: "b2", label: "1.0–2.5s", sub: "25–63f", count: 0, pct: 0 },
    { id: "b3", label: "2.5–5.0s", sub: "63–125f", count: 0, pct: 0 },
    { id: "b4", label: "> 5.0s", sub: ">125f", count: 0, pct: 0 },
  ];
  for (let i = 0; i < n; i += 1) {
    const d = durations[i];
    if (d < 1.0) buckets[0].count += 1;
    else if (d < 2.5) buckets[1].count += 1;
    else if (d <= 5.0) buckets[2].count += 1;
    else buckets[3].count += 1;
  }
  for (const b of buckets) b.pct = n > 0 ? (b.count / n) * 100 : 0;

  const perActionIntervals: { action: string; mean: number; std: number; min: number; max: number; count: number }[] = [];
  for (let i = 0; i < orderedActions.length; i += 1) {
    const action = orderedActions[i];
    const durs = actionDurationsMap.get(action);
    if (!durs || durs.length === 0) continue;
    let sum = 0;
    let min = durs[0];
    let max = durs[0];
    for (let j = 0; j < durs.length; j += 1) {
      const v = durs[j];
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const mean = sum / durs.length;
    let variance = 0;
    for (let j = 0; j < durs.length; j += 1) {
      const diff = durs[j] - mean;
      variance += diff * diff;
    }
    perActionIntervals.push({
      action,
      mean,
      std: Math.sqrt(variance / durs.length),
      min,
      max,
      count: durs.length,
    });
  }
  perActionIntervals.sort((a, b) => b.count - a.count || b.mean - a.mean);

  const maxBin = Math.max(1, ...bins);
  const densityBins = bins.map((v, i) => ({
    label: `${i * 10}%`,
    pct: (v / maxBin) * 100,
    raw: v,
  }));

  return {
    orderedActions,
    speciesNames,
    totalVideos,
    completedVideos,
    totalTargetPairs,
    totalDonePairs,
    totalSegments,
    totalDurationSec,
    actionStats,
    rosePlotItems,
    mosaicColumns,
    mosaicTotalDur,
    minDur,
    maxDur,
    medianDur,
    meanDur,
    stdDur,
    buckets,
    perActionIntervals,
    densityBins,
    foregroundRatio:
      totalVideoSpan > 0 ? Math.min(100, (totalFgSpan / totalVideoSpan) * 100) : 0,
    overlapRatio:
      totalFgSpan > 0 ? Math.min(100, (totalOverlapSpan / totalFgSpan) * 100) : 0,
  };
}
