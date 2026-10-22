/** Bound the playhead to loaded media without changing annotation boundaries. */
export function clampPlaybackTime(time: number, duration?: number): number {
  const target = Math.max(0, Number.isFinite(time) ? time : 0);
  return duration !== undefined && Number.isFinite(duration) && duration >= 0
    ? Math.min(target, duration)
    : target;
}

export const PLAYBACK_RATE_PRESETS = [0.25, 0.5, 1, 1.5, 2, 3] as const;

export function parsePlaybackRate(text: string): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

type RateMedia = Pick<HTMLMediaElement, "playbackRate" | "defaultPlaybackRate">;

/** Keep video and its separate audio at one rate, or restore both on rejection. */
export function applyPlaybackRate(
  media: (RateMedia | null)[],
  rate: number,
): boolean {
  if (!Number.isFinite(rate) || rate <= 0) return false;
  const previous = media.filter((item): item is RateMedia => item !== null).map(
    (item) => ({ item, rate: item.playbackRate, defaultRate: item.defaultPlaybackRate }),
  );
  try {
    for (const { item } of previous) {
      item.playbackRate = rate;
      item.defaultPlaybackRate = rate;
    }
    return true;
  } catch {
    for (const { item, rate: oldRate, defaultRate } of previous) {
      try {
        item.playbackRate = oldRate;
        item.defaultPlaybackRate = defaultRate;
      } catch {
        // A detached/failed media element must not prevent restoring the other one.
      }
    }
    return false;
  }
}
