import { useEffect, useRef } from "react";

/** Plays a soft two-note chime via Web Audio when `trigger` increases and enabled. */
export function useAlertSound(trigger: number, enabled: boolean) {
  const prev = useRef(trigger);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (enabled && trigger > prev.current) {
      try {
        const Ctx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = (ctxRef.current ??= new Ctx());
        const now = ctx.currentTime;
        // Soft, warm two-note chime through a low-pass filter — gentle, not shrill.
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 1400;
        lp.connect(ctx.destination);
        [523.25, 659.25].forEach((f, i) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = "sine";
          o.frequency.value = f;
          o.connect(g);
          g.connect(lp);
          const t0 = now + i * 0.16;
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.05);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
          o.start(t0);
          o.stop(t0 + 0.55);
        });
      } catch {
        /* audio blocked until user gesture — ignore */
      }
    }
    prev.current = trigger;
  }, [trigger, enabled]);
}
