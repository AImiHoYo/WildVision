import brandIconUrl from "../../../../assets/branding/wildvision-icon.png";
import { cn } from "../../lib/cn";

export function BrandIcon({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <img
      src={brandIconUrl}
      alt="WildVision Studio 图标"
      width={size}
      height={size}
      draggable={false}
      className={cn("shrink-0 select-none rounded-md bg-white object-contain", className)}
    />
  );
}
