import type { ReactNode } from "react";
import { useTween } from "../lib/motion.ts";

export function Panel({
  eyebrow,
  title,
  right,
  children,
  className = "",
  bodyClass = "",
}: {
  eyebrow?: string;
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`panel h-full ${className}`}>
      <div className="panel-h">
        <div>
          {eyebrow && <div className="panel-eyebrow">{eyebrow}</div>}
          <div className="panel-title">{title}</div>
        </div>
        {right && <div className="text-right">{right}</div>}
      </div>
      <div className={`flex-1 min-h-0 px-4 pb-3 ${bodyClass}`}>{children}</div>
    </section>
  );
}

/** A number that counts up/down smoothly whenever it changes. */
export function TweenNumber({
  value,
  format,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const v = useTween(value);
  return <span className={className}>{format ? format(v) : Math.round(v).toLocaleString()}</span>;
}
