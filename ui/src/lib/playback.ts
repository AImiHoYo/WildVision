/** Bound the playhead to loaded media without changing annotation boundaries. */
export function clampPlaybackTime(time: number, duration?: number): number {
  const target = Math.max(0, Number.isFinite(time) ? time : 0);
  return duration !== undefined && Number.isFinite(duration) && duration >= 0
    ? Math.min(target, duration)
    : target;
}
