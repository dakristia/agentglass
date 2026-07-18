import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Renders children into document.body so they escape panel stacking contexts. */
export function Portal({ children }: { children: ReactNode }) {
  const [el] = useState(() => document.createElement("div"));
  useEffect(() => {
    el.style.position = "relative";
    el.style.zIndex = "9999";
    document.body.appendChild(el);
    return () => {
      document.body.removeChild(el);
    };
  }, [el]);
  return createPortal(children, el);
}
