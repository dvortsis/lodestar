/** Shared Lodestar mark from `public/compass_logo.png` (UI). Favicon: `public/compass_icon.ico` via layout metadata. */
const BRAND_IMG = "/compass_logo.png";

export function LodestarBrandIcon({
  className,
  alt = "Lodestar",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <img
      alt={alt}
      className={className}
      decoding="async"
      draggable={false}
      src={BRAND_IMG}
    />
  );
}
