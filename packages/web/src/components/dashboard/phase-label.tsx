import { useRef, useEffect } from "react";
import { animate } from "motion";
import { cn } from "@/lib/utils";

const FAST_SPRING = {
  type: "spring" as const,
  visualDuration: 0.35,
  bounce: 0,
};

interface PhaseLabelProps {
  text: string | null;
  className?: string;
}

export function PhaseLabel({ text, className }: PhaseLabelProps) {
  const enterRef = useRef<HTMLSpanElement>(null);
  const leaveRef = useRef<HTMLSpanElement>(null);
  const prevRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = text;

    if (prev === text) return;

    const enterEl = enterRef.current;
    const leaveEl = leaveRef.current;

    // First render — no animation
    if (prev === undefined) return;

    // Animate leave (old text)
    if (leaveEl && prev) {
      leaveEl.textContent = prev;
      leaveEl.style.position = "absolute";
      leaveEl.style.inset = "0";
      leaveEl.style.opacity = "1";

      const leaveAnim = animate(
        leaveEl,
        {
          opacity: [1, 0],
          filter: ["blur(0px)", "blur(2px)"],
          transform: ["translateY(0)", "translateY(2px)"],
        },
        FAST_SPRING,
      );
      leaveAnim.finished.then(() => {
        leaveEl.style.opacity = "0";
        leaveEl.style.filter = "";
        leaveEl.style.transform = "";
        leaveEl.style.position = "";
        leaveEl.style.inset = "";
        leaveEl.textContent = "";
        return undefined;
      });
    }

    // Animate enter (new text)
    if (enterEl && text) {
      animate(
        enterEl,
        {
          opacity: [0, 1],
          filter: ["blur(2px)", "blur(0px)"],
          transform: ["translateY(-2px)", "translateY(0)"],
        },
        FAST_SPRING,
      );
    }
  });

  if (!text) return null;

  return (
    <span className={cn("relative inline-block overflow-hidden", className)}>
      <span ref={enterRef}>{text}</span>
      <span ref={leaveRef} className="pointer-events-none" aria-hidden />
    </span>
  );
}
