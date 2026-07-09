/**
 * Every timing the dock animates on, in one tunable place. Production renders
 * `SessionDock` with `DEFAULT_DOCK_MOTION`; the story exposes each field as a
 * Storybook knob so the feel can be dialed in, then the winning numbers copied
 * back into the defaults below.
 *
 * One model, applied to the whole line: height, title, line width, and colour
 * all ride a single CSS ease-out (`--dock-ease`) with an enter/exit duration
 * pair, so a line reveals and collapses as one object. `dockMotionVars` is
 * applied inline on the nav, overriding the class-level fallback on the same
 * element, and every transition is gated behind `prefers-reduced-motion`.
 */

import type { CSSProperties } from "react";

export interface DockMotion {
	/** Reveal (hover/focus in) — height grow, title fade/slide, line widen. */
	readonly enterMs: number;
	/** Collapse (hover/focus out). */
	readonly exitMs: number;
	/** One shared easing for both directions. */
	readonly curve: string;
}

export const DEFAULT_DOCK_MOTION: DockMotion = {
	enterMs: 180,
	exitMs: 130,
	curve: "cubic-bezier(0.32, 0.72, 0, 1)",
};

/** The `--dock-*` custom properties the dock classes read for their transitions. */
export const dockMotionVars = (m: DockMotion): CSSProperties =>
	({
		"--dock-enter": `${m.enterMs}ms`,
		"--dock-exit": `${m.exitMs}ms`,
		"--dock-ease": m.curve,
	}) as CSSProperties;
