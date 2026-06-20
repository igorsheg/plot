import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────
// Layout primitives — the only sanctioned way to add space + data styling in
// app views. This module IS the design system for the dashboard; views conform
// to it, never the reverse.
//
// Strict 4px base vertical rhythm: every gap/padding/margin is a multiple of
// 4px. Tailwind v4's spacing scale is 4px/step, so this means INTEGER STEPS
// ONLY — no `*-0.5` (2px), `*-1.5` (6px), `*-2.5` (10px). Fractional steps are
// forbidden in views. Gaps go through `Stack`/`Row` `gap={step}`; the page
// horizontal inset is the `px-gutter` token (24px); everything else is an
// integer Tailwind step.
//
// Typography — a fixed scale (see globals.css @theme) used as four roles.
// Each role is a size + weight + (mono?) combo; a view reaches for the role,
// never a one-off. No ad-hoc `text-[..px]`, no ad-hoc `tracking-[..]`, no bare
// `font-mono`/`tabular-nums` outside the primitives that own them.
//
//   Title       text-base font-medium            the one page H1
//   Label       text-sm   font-medium            primary row/nav labels
//   Secondary   text-sm   (normal)               descriptive text
//   Data        text-2xs  font-mono tabular-nums  machine data — owned by <Meta>
//
// text-xs/text-lg exist in the scale for coss components but are not used in
// app views. Status accent bars go through <Rail>.
// ─────────────────────────────────────────────────────────────────────────

export const rhythm = {
	1: 4,
	2: 8,
	3: 12,
	4: 16,
	5: 20,
	6: 24,
	8: 32,
} as const satisfies Record<string, number>;

export type RhythmStep = keyof typeof rhythm;

const gapStyle = (step: RhythmStep): React.CSSProperties => ({
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

// ─── data line ───────────────────────────────────────────────────────────
// The mono "machine data" text role: numerics, identifiers, ages, meta. One
// component owns the font/size/tabular-nums combo so the ~15 callsites that
// repeated `font-mono text-2xs text-t3 tabular-nums` reach for this instead.
// Tone is an explicit variant (patterns-explicit-variants), not a boolean.

export type MetaTone =
	| "default"
	| "muted"
	| "foreground"
	| "live"
	| "attention"
	| "destructive";

const metaTone: Record<MetaTone, string> = {
	default: "text-t3",
	muted: "text-muted-foreground",
	foreground: "text-foreground",
	live: "text-live",
	attention: "text-attention",
	destructive: "text-destructive",
};

export function Meta({
	children,
	tone = "default",
	className,
}: {
	children: ReactNode;
	tone?: MetaTone;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"font-mono text-2xs tabular-nums",
				metaTone[tone],
				className,
			)}
		>
			{children}
		</span>
	);
}

// ─── meta control ────────────────────────────────────────────────────────
// A button styled in the Data role (mono, 2xs, t3) that promotes to foreground
// on hover — chrome that reads as meta, not a primary action. Owns the type
// tokens so controls never re-derive `font-mono text-2xs text-t3`; callers add
// layout (padding / flex / icon gap) via `className`.
export function MetaButton({
	children,
	className,
	...props
}: {
	children: ReactNode;
	className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button
			type="button"
			className={cn(
				"font-mono text-2xs text-t3 transition-colors hover:text-foreground",
				className,
			)}
			{...props}
		>
			{children}
		</button>
	);
}

// ─── status rail ─────────────────────────────────────────────────────────
// The 3px rounded status accent that marks a thread's liveness/needs-you
// state. The 3px width is a deliberate hairline owned here — it is a stroke,
// not spacing, so it is exempt from the 4px spacing grid but must not appear
// ad-hoc in views. Callers pass height/positioning via `className`.

export type RailTone = "attention" | "live" | "border" | "outline";

const railTone: Record<RailTone, string> = {
	attention: "bg-attention",
	live: "bg-live",
	border: "bg-border",
	outline: "bg-transparent shadow-[inset_0_0_0_1px_var(--color-border)]",
};

export function Rail({
	tone = "border",
	className,
}: {
	tone?: RailTone;
	className?: string;
}) {
	return (
		<span
			aria-hidden
			className={cn(
				"shrink-0 rounded-full bg-border w-[3px]",
				railTone[tone],
				className,
			)}
		/>
	);
}
