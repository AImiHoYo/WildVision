import { focusField } from "../../lib/focusField";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export type SegmentOption<T extends string> = {
  id: T;
  label: ReactNode;
};

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  fullWidth = true,
  tone = "surface",
  size = "sm",
  className = "",
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (id: T) => void;
  fullWidth?: boolean;
  tone?: "surface" | "accent";
  size?: "xs" | "sm" | "md";
  className?: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [thumb, setThumb] = useState({ left: 0, width: 0 });
  const [hoverThumb, setHoverThumb] = useState<{
    left: number;
    width: number;
    visible: boolean;
  }>({ left: 0, width: 0, visible: false });

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value),
  );
  const optionKey = options.map((option) => option.id).join("|");

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const button = buttonRefs.current[selectedIndex];
      if (!button) return;
      const left = button.offsetLeft;
      const width = button.offsetWidth;
      setThumb((prev) =>
        prev.left === left && prev.width === width ? prev : { left, width },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    buttonRefs.current.forEach((button) => {
      if (button) observer.observe(button);
    });
    return () => observer.disconnect();
  }, [optionKey, selectedIndex, options.length]);

  const moveTo = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (option.id !== value) onChange(option.id);
    focusField(buttonRefs.current[index]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1;
    let next = selectedIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = selectedIndex >= last ? 0 : selectedIndex + 1;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = selectedIndex <= 0 ? last : selectedIndex - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      return;
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    moveTo(next);
  };

  const handleMouseEnter = (index: number) => {
    const button = buttonRefs.current[index];
    if (!button) return;
    setHoverThumb({
      left: button.offsetLeft,
      width: button.offsetWidth,
      visible: true,
    });
  };

  const handleMouseLeave = () => {
    setHoverThumb((prev) => ({ ...prev, visible: false }));
  };

  const padClass =
    size === "xs"
      ? "px-2 py-0.5 text-[10px]"
      : size === "md"
        ? "px-3 py-1.5 text-xs"
        : "px-2.5 py-1 text-[11px]";

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={label}
      data-key-scope="studio-field"
      onKeyDown={onKeyDown}
      onMouseLeave={handleMouseLeave}
      className={cn(
        "relative items-center rounded-lg border border-line/70 bg-card/85 p-0.5 select-none",
        fullWidth ? "flex w-full min-w-0" : "inline-flex w-auto",
        className,
      )}
    >
      {/* Silky Hover Follower Pill */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0.5 top-0.5 rounded-[6px] bg-ink/[0.05] transition-[transform,width,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        style={{
          width: hoverThumb.width,
          transform: `translate3d(${hoverThumb.left}px, 0, 0)`,
          opacity: hoverThumb.visible ? 1 : 0,
        }}
      />

      {/* iOS Spring Active Pill Thumb */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute bottom-0.5 top-0.5 rounded-[6px] transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          tone === "accent"
            ? "bg-mark shadow-[0_1px_3px_rgba(37,99,235,0.35)]"
            : "bg-panel shadow-[0_1px_3px_rgba(15,23,42,0.1),0_1px_1px_rgba(15,23,42,0.06)] ring-1 ring-black/[0.04]",
        )}
        style={{
          width: thumb.width,
          transform: `translate3d(${thumb.left}px, 0, 0)`,
        }}
      />

      {options.map((option, index) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onMouseEnter={() => handleMouseEnter(index)}
            onPointerDown={(event) => delete event.currentTarget.dataset.kbd}
            onBlur={(event) => delete event.currentTarget.dataset.kbd}
            onClick={() => onChange(option.id)}
            className={cn(
              "relative z-10 min-w-fit whitespace-nowrap rounded-[6px] transition-[color,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mark data-[kbd=true]:ring-2 data-[kbd=true]:ring-mark",
              fullWidth ? "flex-1" : "",
              padClass,
              selected
                ? tone === "accent"
                  ? "font-semibold text-white"
                  : "font-semibold text-ink"
                : "font-medium text-mute hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
