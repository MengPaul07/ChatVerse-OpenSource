import type { CSSProperties, ReactNode } from "react";
import type { WorldTemplatePack } from "../worldTemplateCatalog";

interface WorldTemplateCoverProps {
  template: WorldTemplatePack;
  className: string;
  children?: ReactNode;
  decorative?: boolean;
}

export function WorldTemplateCover({
  template,
  className,
  children,
  decorative = true,
}: WorldTemplateCoverProps) {
  const cover = template.assets.cover;
  const focalPoint = cover.focalPoint ?? { x: 0.5, y: 0.5 };
  const style = {
    backgroundColor: cover.dominantColor,
    backgroundImage: `url(${cover.src})`,
    backgroundPosition: `${focalPoint.x * 100}% ${focalPoint.y * 100}%`,
  } satisfies CSSProperties;

  return (
    <div
      className={className}
      style={style}
      aria-hidden={decorative || undefined}
    >
      {children}
    </div>
  );
}
