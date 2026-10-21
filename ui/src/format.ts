export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.round(seconds * 1000);
  const ms = total % 1000;
  const totalSec = Math.floor(total / 1000);
  const second = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const minute = totalMin % 60;
  const hour = Math.floor(totalMin / 60);
  const body = `${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  return hour ? `${hour}:${body}` : body;
}

export function nlQuery(animal: string, action: string): string {
  return `A ${animal} is ${action.toLowerCase()}.`;
}

function jsRound(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

export function frameIndex(seconds: number, fps: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(fps) || fps <= 0) return 0;
  const rounded = jsRound(seconds * 1000) / 1000;
  return Math.max(0, jsRound(rounded * fps));
}

export function frameLabel(frame: number): string {
  return `F${String(Math.max(0, frame)).padStart(4, "0")}`;
}
