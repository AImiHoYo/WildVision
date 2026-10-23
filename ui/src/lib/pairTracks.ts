import type { LabelItem, SegmentItem } from "../types";

export type PairTrack = { key: string; animal: string; action: string; sourceTrackIndex: number };

/** Rows describe label pairs, not inferred animal identities. Storage indices stay intact. */
export function buildPairTracks(
  labels: LabelItem[], listAnimal: string[], segments: SegmentItem[] = [],
): PairTrack[] {
  const rows: PairTrack[] = [];
  const seen = new Set<string>();
  for (const item of [...labels, ...segments]) {
    const key = JSON.stringify([item.animal, item.action]);
    if (seen.has(key)) continue;
    seen.add(key);
    const first = listAnimal.indexOf(item.animal);
    const fallback = "track_index" in item && typeof item.track_index === "number" ? item.track_index : 0;
    rows.push({ key, animal: item.animal, action: item.action, sourceTrackIndex: first < 0 ? fallback : first });
  }
  return rows;
}

export function pairSegments(segments: SegmentItem[], animal: string, action: string) {
  return segments.filter((item) => item.animal === animal && item.action === action);
}

/** Duration statistics count presence of each pair, not repeated legacy slots. */
export function mergePairSegments(segments: SegmentItem[]): SegmentItem[] {
  const groups = new Map<string, SegmentItem[]>();
  for (const segment of segments) {
    const key = JSON.stringify([segment.animal, segment.action]);
    const items = groups.get(key) ?? [];
    items.push({ ...segment });
    groups.set(key, items);
  }
  const result: SegmentItem[] = [];
  for (const items of groups.values()) {
    items.sort((a, b) => a.start - b.start || a.end - b.end);
    let last: SegmentItem | undefined;
    for (const item of items) {
      if (last && item.start <= last.end + 1e-4) last.end = Math.max(last.end, item.end);
      else { result.push(item); last = item; }
    }
  }
  return result;
}
