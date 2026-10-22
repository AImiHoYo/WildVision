import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn";
import { parsePlaybackRate, PLAYBACK_RATE_PRESETS } from "../../lib/playback";

export function PlaybackSpeedControl({ value, onChange, disabled = false }: {
  value: number;
  onChange: (rate: number) => boolean;
  disabled?: boolean;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState("");
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false });

  const close = () => {
    setOpen(false);
    anchor.current?.focus();
  };

  const apply = (rate: number) => {
    if (onChange(rate)) close();
    else setError("当前播放组件不支持这个倍速，请换一个数值。");
  };

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!anchor.current?.contains(target) && !panel.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const fit = () => {
      if (!anchor.current || !panel.current) return;
      const button = anchor.current.getBoundingClientRect();
      const popup = panel.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(button.left, window.innerWidth - popup.width - 8));
      let top = button.top - popup.height - 8;
      if (top < 8) top = button.bottom + 8;
      top = Math.max(8, Math.min(top, window.innerHeight - popup.height - 8));
      setPosition({ top, left, ready: true });
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, true);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit, true);
    };
  }, [open, error]);

  return <>
    <button ref={anchor} type="button" disabled={disabled} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`播放倍速，当前 ${value} 倍`} title="设置播放倍速"
      onClick={() => {
        setDraft(String(value)); setError("");
        setPosition((previous) => ({ ...previous, ready: false }));
        setOpen((previous) => !previous);
      }}
      className="inline-flex h-7 min-w-[42px] shrink-0 items-center justify-center rounded-lg px-1.5 font-mono text-[11px] font-semibold text-ink hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark/60 disabled:cursor-not-allowed disabled:opacity-35">
      {value}×
    </button>
    {open && createPortal(
      <div ref={panel} role="dialog" aria-label="设置播放倍速" data-key-scope="studio-field"
        className="fixed z-[80] w-60 max-w-[calc(100vw-16px)] rounded-xl border border-line bg-panel p-3 text-xs text-ink shadow-xl"
        style={{ top: position.top, left: position.left, visibility: position.ready ? "visible" : "hidden" }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") { event.preventDefault(); close(); }
        }}>
        <div className="mb-2 font-semibold">播放倍速</div>
        <div className="mb-3 grid grid-cols-3 gap-1.5">
          {PLAYBACK_RATE_PRESETS.map((rate) => <button key={rate} type="button"
            aria-label={`${rate} 倍速`} aria-pressed={value === rate}
            onClick={() => apply(rate)}
            className={cn("rounded-md border px-2 py-1.5 font-mono hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark", value === rate ? "border-mark bg-mark text-white" : "border-line bg-card")}>
            {rate}×
          </button>)}
        </div>
        <form noValidate onSubmit={(event) => {
          event.preventDefault();
          const rate = parsePlaybackRate(draft);
          if (rate === null) { setError("请输入大于 0 的有效倍速。"); return; }
          apply(rate);
        }}>
          <label className="mb-1.5 block text-mute" htmlFor="custom-playback-rate">自定义倍速</label>
          <div className="flex items-center gap-2">
            <input id="custom-playback-rate" type="number" inputMode="decimal" step="any"
              aria-label="自定义倍速" aria-invalid={Boolean(error)}
              aria-describedby={error ? "playback-rate-error" : undefined}
              value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }}
              className="h-8 min-w-0 flex-1 rounded-md border border-line bg-studio px-2 font-mono focus:border-mark focus:outline-none" />
            <button type="submit" className="h-8 rounded-md bg-mark px-3 font-medium text-white">应用</button>
          </div>
          {error && <p id="playback-rate-error" role="alert" className="mt-2 text-red-500">{error}</p>}
        </form>
      </div>, document.body,
    )}
  </>;
}
