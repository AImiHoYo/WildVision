import { useEffect, useState } from "react";
import { Film } from "lucide-react";

const WIDTH_480P = 854;
const HEIGHT_480P = 480;
const MAX_THUMB_CACHE = 400;
const MAX_CONCURRENT_EXTRACTIONS = 3;

const thumbCache = new Map<string, string>();
let activeExtractions = 0;
const waitQueue: { run: () => void; cancel: () => void }[] = [];

function setCacheEntry(key: string, dataUrl: string): void {
  if (thumbCache.size >= MAX_THUMB_CACHE) {
    const oldestKey = thumbCache.keys().next().value;
    if (oldestKey) thumbCache.delete(oldestKey);
  }
  thumbCache.set(key, dataUrl);
}

function acquireSlot(signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) {
    return Promise.resolve(false);
  }
  if (activeExtractions < MAX_CONCURRENT_EXTRACTIONS) {
    activeExtractions += 1;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const entry = {
      run: () => {
        if (signal) signal.removeEventListener("abort", onAbort);
        activeExtractions += 1;
        resolve(true);
      },
      cancel: () => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve(false);
      },
    };
    const onAbort = () => {
      const idx = waitQueue.indexOf(entry);
      if (idx >= 0) {
        waitQueue.splice(idx, 1);
      }
      entry.cancel();
    };
    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    waitQueue.push(entry);
  });
}

function releaseSlot(): void {
  activeExtractions = Math.max(0, activeExtractions - 1);
  const next = waitQueue.shift();
  if (next) next.run();
}

function renderFallback480pPoster(
  videoId: string,
  species: string,
  fps: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH_480P;
  canvas.height = HEIGHT_480P;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  let hash = 0;
  const seedStr = `${species}:${videoId}`;
  for (let i = 0; i < seedStr.length; i += 1) {
    hash = (hash * 31 + seedStr.charCodeAt(i)) >>> 0;
  }
  const hue1 = hash % 360;
  const hue2 = (hue1 + 42) % 360;

  const grad = ctx.createLinearGradient(0, 0, WIDTH_480P, HEIGHT_480P);
  grad.addColorStop(0, `hsl(${hue1}, 42%, 18%)`);
  grad.addColorStop(0.55, `hsl(${hue2}, 38%, 14%)`);
  grad.addColorStop(1, "#0B0F17");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH_480P, HEIGHT_480P);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  for (let x = 1; x < 3; x += 1) {
    ctx.beginPath();
    ctx.moveTo((WIDTH_480P / 3) * x, 0);
    ctx.lineTo((WIDTH_480P / 3) * x, HEIGHT_480P);
    ctx.stroke();
  }
  for (let y = 1; y < 3; y += 1) {
    ctx.beginPath();
    ctx.moveTo(0, (HEIGHT_480P / 3) * y);
    ctx.lineTo(WIDTH_480P, (HEIGHT_480P / 3) * y);
    ctx.stroke();
  }

  const cx = WIDTH_480P * (0.35 + ((hash % 30) / 100));
  const cy = HEIGHT_480P * (0.42 + (((hash >> 5) % 20) / 100));
  const radGrad = ctx.createRadialGradient(cx, cy, 12, cx, cy, 170);
  radGrad.addColorStop(0, `hsla(${hue1}, 80%, 62%, 0.34)`);
  radGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = radGrad;
  ctx.beginPath();
  ctx.arc(cx, cy, 170, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `hsla(${hue1}, 85%, 68%, 0.5)`;
  ctx.lineWidth = 2;
  ctx.strokeRect(cx - 110, cy - 68, 220, 136);

  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.font = "600 30px -apple-system, BlinkMacSystemFont, 'Inter', sans-serif";
  ctx.fillText(species || "视频预览", 42, HEIGHT_480P - 68);

  ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
  ctx.font = "500 20px 'JetBrains Mono', monospace";
  ctx.fillText(`${videoId} · ${fps || 25} fps`, 42, HEIGHT_480P - 34);

  return canvas.toDataURL("image/jpeg", 0.82);
}

async function extractFirstFrame480p(
  videoUrl: string,
  videoId: string,
  species: string,
  fps: number,
  isSyntheticSample: boolean,
  signal?: AbortSignal,
): Promise<string> {
  const cacheKey = `${isSyntheticSample ? "sample" : videoUrl || "fallback"}::${videoId}::${species}`;
  const hit = thumbCache.get(cacheKey);
  if (hit) return hit;

  if (!videoUrl || isSyntheticSample) {
    const fallback = renderFallback480pPoster(videoId, species, fps);
    setCacheEntry(cacheKey, fallback);
    return fallback;
  }

  const acquired = await acquireSlot(signal);
  if (!acquired) return "";

  try {
    if (signal?.aborted) return "";
    const again = thumbCache.get(cacheKey);
    if (again) return again;

    const dataUrl = await new Promise<string>((resolve) => {
      const video = document.createElement("video");
      let settled = false;

      const finish = (result: string) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", onAbort);
        video.removeAttribute("src");
        video.load();
        resolve(result);
      };

      const onAbort = () => finish("");
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }

      const timer = window.setTimeout(() => {
        finish(renderFallback480pPoster(videoId, species, fps));
      }, 3500);

      video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";

      const drawFrame = () => {
        try {
          const vw = video.videoWidth || WIDTH_480P;
          const vh = video.videoHeight || HEIGHT_480P;
          const canvas = document.createElement("canvas");
          canvas.width = WIDTH_480P;
          canvas.height = HEIGHT_480P;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            finish(renderFallback480pPoster(videoId, species, fps));
            return;
          }
          ctx.fillStyle = "#0A0C10";
          ctx.fillRect(0, 0, WIDTH_480P, HEIGHT_480P);

          const scale = Math.max(WIDTH_480P / vw, HEIGHT_480P / vh);
          const dw = vw * scale;
          const dh = vh * scale;
          const dx = (WIDTH_480P - dw) / 2;
          const dy = (HEIGHT_480P - dh) / 2;
          ctx.drawImage(video, dx, dy, dw, dh);

          const out = canvas.toDataURL("image/jpeg", 0.82);
          finish(out);
        } catch {
          finish(renderFallback480pPoster(videoId, species, fps));
        }
      };

      video.onloadeddata = () => {
        try {
          if (video.duration && video.duration > 0.05) {
            const target = Math.min(0.04, video.duration * 0.01);
            video.currentTime = target;
          } else {
            drawFrame();
          }
        } catch {
          drawFrame();
        }
      };

      video.onseeked = () => {
        drawFrame();
      };

      video.onerror = () => {
        finish(renderFallback480pPoster(videoId, species, fps));
      };

      video.src = videoUrl;
    });

    if (dataUrl) {
      setCacheEntry(cacheKey, dataUrl);
    }
    return dataUrl;
  } finally {
    releaseSlot();
  }
}

type Props = {
  videoUrl: string;
  videoId: string;
  species: string;
  fps?: number;
  isSyntheticSample?: boolean;
  className?: string;
};

export function VideoFirstFrame480p({
  videoUrl,
  videoId,
  species,
  fps = 25,
  isSyntheticSample = false,
  className = "",
}: Props) {
  const cacheKey = `${isSyntheticSample ? "sample" : videoUrl || "fallback"}::${videoId}::${species}`;
  const [thumbUrl, setThumbUrl] = useState<string>(
    () => thumbCache.get(cacheKey) || "",
  );

  useEffect(() => {
    const existing = thumbCache.get(cacheKey);
    if (existing) {
      setThumbUrl(existing);
      return;
    }
    const controller = new AbortController();
    void extractFirstFrame480p(
      videoUrl,
      videoId,
      species,
      fps,
      isSyntheticSample,
      controller.signal,
    ).then((url) => {
      if (!controller.signal.aborted && url) {
        setThumbUrl(url);
      }
    });
    return () => {
      controller.abort();
    };
  }, [cacheKey, videoUrl, videoId, species, fps, isSyntheticSample]);

  return (
    <div
      className={`relative aspect-video w-full overflow-hidden bg-[#0A0C10] ${className}`}
    >
      {thumbUrl ? (
        <img
          src={thumbUrl}
          alt={`${videoId} 视频预览`}
          width={WIDTH_480P}
          height={HEIGHT_480P}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[#0F141C] text-mute">
          <Film size={16} className="animate-pulse opacity-60" />
        </div>
      )}
    </div>
  );
}
