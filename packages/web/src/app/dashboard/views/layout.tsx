import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────
// Layout primitives — the only sanctioned way to add space in app views.
//
// Strict 4px base vertical rhythm: every gap/padding is a multiple of 4px, taken
// from the `rhythm` map (4/8/12/16/24/32). No ad-hoc Tailwind spacing utility
// (`pt-5`, `gap-0.5`, `py-1.5`, …) is permitted in a view — reach for these so
// the rhythm is enforced structurally, not policed by eye.
//
// Typography is capped at three roles per view (see globals.css):
//   text-2xs (11px, mono)  — machine data, meta, micro labels
//   text-sm   (13px)       — primary row text / labels
//   text-base (14px)       — the one emphasized title per view
// ─────────────────────────────────────────────────────────────────────────

export const rhythm = {
	1: 4,
	2: 8,
	3: 12,
	4: 16,
	6: 24,
	8: 32,
} as const satisfies Record<string, number>;

export type RhythmStep = keyof typeof rhythm;

const gapStyle = (step: RhythmStep): CSSProperties => ({
	gap: `${rhythm[step]}px`,
});

/** Vertical stack on the 4px rhythm. */
export function Stack({
	children,
	gap = 2,
	className,
}: {
	children: ReactNode;
	gap?: RhythmStep;
	className?: string;
}) {
	return (
		<div className={cn("flex flex-col", className)} style={gapStyle(gap)}>
			{children}
		</div>
	);
}

/** Horizontal row on the 4px rhythm. */
export function Row({
	children,
	gap = 2,
	className,
}: {
	children: ReactNode;
	gap?: RhythmStep;
	className?: string;
}) {
	return (
		<div className={cn("flex items-center", className)} style={gapStyle(gap)}>
			{children}
		</div>
	);
}

/** A micro section label — the only heading role below the page title. mono, 11px. */
export function SectionLabel({
	children,
	count,
	className,
}: {
	children: ReactNode;
	count?: number;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex items-baseline justify-between font-mono text-2xs text-t3",
				className,
			)}
		>
			<span>{children}</span>
			{count === undefined ? null : (
				<span className="tabular-nums">{count}</span>
			)}
		</div>
	);
}
