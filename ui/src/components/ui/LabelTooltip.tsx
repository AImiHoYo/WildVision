import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { lookupLabel, parseLabelHints, type LabelReference } from "../../lib/labelHints";

const ID = "wildvision-label-tooltip";
type Hint = { anchor: HTMLElement; labels: LabelReference[]; detail?: string };

/** Delegated tooltip avoids adding wrappers inside draggable / truncated labels. */
export function LabelTooltip() {
  const [hint, setHint] = useState<Hint | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dismissTimer: ReturnType<typeof setTimeout> | undefined;
    let current: HTMLElement | null = null;
    let described: HTMLElement | null = null;
    let originalDescription: string | null = null;
    let pointerDown = false;
    let shown = false;
    const clearDescription = () => {
      if (described) {
        if (originalDescription === null) described.removeAttribute("aria-describedby");
        else described.setAttribute("aria-describedby", originalDescription);
      }
      described = null;
    };
    const hide = () => {
      clearTimeout(timer);
      clearTimeout(dismissTimer);
      clearDescription();
      current = null;
      shown = false;
      setHint(null);
    };
    const enter = (event: Event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.type === "focusin" && pointerDown) return;
      if (target?.closest(`#${ID}`)) {
        clearTimeout(dismissTimer);
        return;
      }
      const anchor = target?.closest<HTMLElement>("[data-label-hint]") ?? null;
      if (anchor === current) {
        clearTimeout(dismissTimer);
        return;
      }
      hide();
      if (!anchor || (event instanceof PointerEvent && event.buttons !== 0)) return;
      const labels = parseLabelHints(anchor.dataset.labelHint || "");
      if (labels.length === 0) return;
      current = anchor;
      timer = setTimeout(() => {
        if (!anchor.isConnected) return;
        described = anchor;
        originalDescription = anchor.getAttribute("aria-describedby");
        anchor.setAttribute("aria-describedby", [originalDescription, ID].filter(Boolean).join(" "));
        shown = true;
        setHint({ anchor, labels, detail: anchor.dataset.labelDetail });
      }, event.type === "focusin" ? 0 : 400);
    };
    const leave = (event: PointerEvent) => {
      if (event.relatedTarget instanceof Node && current?.contains(event.relatedTarget)) return;
      if (event.relatedTarget instanceof Element && event.relatedTarget.closest(`#${ID}`)) return;
      if (!shown) { hide(); return; }
      clearTimeout(timer);
      clearTimeout(dismissTimer);
      dismissTimer = setTimeout(hide, 120);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") hide(); };
    const down = () => { pointerDown = true; hide(); };
    const up = () => { pointerDown = false; };
    const scroll = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(`#${ID}`)) return;
      // Keyboard selection calls scrollIntoView after focus. Keep that hint and
      // reposition it rather than cancelling it during the same event loop.
      if (current && !pointerDown && current.contains(document.activeElement)) {
        if (shown) setHint((previous) => previous ? { ...previous } : null);
        return;
      }
      hide();
    };
    document.addEventListener("pointerover", enter);
    document.addEventListener("pointerout", leave);
    document.addEventListener("focusin", enter);
    document.addEventListener("focusout", hide);
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    document.addEventListener("keydown", escape);
    document.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", hide);
    window.addEventListener("blur", hide);
    return () => {
      clearTimeout(timer);
      clearTimeout(dismissTimer);
      clearDescription();
      document.removeEventListener("pointerover", enter);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("focusin", enter);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      document.removeEventListener("keydown", escape);
      document.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", hide);
      window.removeEventListener("blur", hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!hint || !box.current) return;
    const anchor = hint.anchor.getBoundingClientRect();
    const bounds = box.current.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8));
    const below = anchor.bottom + 8;
    const top = below + bounds.height <= window.innerHeight - 8
      ? below : Math.max(8, anchor.top - bounds.height - 8);
    setPosition({ left, top });
  }, [hint]);

  if (!hint) return null;
  return createPortal(
    <div ref={box} id={ID} role="tooltip" style={position}
      className="fixed z-[200] max-h-[calc(100vh-16px)] w-max max-w-[min(380px,calc(100vw-16px))] overflow-y-auto rounded-lg border border-line bg-panel px-3 py-2 text-xs text-ink shadow-xl">
      <div className="space-y-2">
        {hint.labels.map(({ kind, label }, index) => {
          const entry = lookupLabel(kind, label);
          const translated = entry?.status === "translated" && entry.zh;
          return <div key={`${kind}-${label}-${index}`}>
            <div className="break-words font-semibold [overflow-wrap:anywhere]">{label}</div>
            <div className="mt-0.5 break-words text-mute [overflow-wrap:anywhere]">
              {translated ? entry.zh : entry ? "中文译名待核对" : "暂无中文对照"}
            </div>
            {entry?.scientificName && <div className="mt-0.5 text-mute italic">{entry.scientificName}</div>}
            {entry?.note && <div className="mt-1 break-words text-[11px] leading-relaxed text-mute">{entry.note}</div>}
          </div>;
        })}
      </div>
      {hint.detail && <div className="mt-2 border-t border-line pt-1.5 text-[11px] text-mute">{hint.detail}</div>}
    </div>, document.body,
  );
}
