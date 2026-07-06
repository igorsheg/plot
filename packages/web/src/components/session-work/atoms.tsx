/**
 * Tiny presentational atoms shared by the river rows and the detail drawer: the
 * status dot (one vocabulary) and the streaming caret. Kept here (not in
 * `session-work.tsx`) so the drawer can reuse them without an import cycle.
 */

import type { CSSProperties } from "react";

export type DotKind = "active" | "queued" | "attention" | "done";

const dotStyles: Record<DotKind, CSSProperties> = {
	active: { background: "var(--text-color-kumo-default)" },
	queued: {
		background: "transparent",
		boxShadow: "inset 0 0 0 1.5px var(--text-color-kumo-subtle)",
	},
	attention: { background: "var(--color-kumo-danger)" },
	done: { background: "var(--text-color-kumo-subtle)" },
};

/** Bare dot color/box for a kind, without the row's top margin. */
export const dotStyle = (kind: DotKind): CSSProperties => ({
	borderRadius: 999,
	flex: "0 0 auto",
	height: 8,
	width: 8,
	...dotStyles[kind],
});

export function Dot({ kind }: { readonly kind: DotKind }) {
	return (
		<span aria-hidden="true" style={{ marginTop: 8, ...dotStyle(kind) }} />
	);
}

/** Blinking stream caret — rendered only while an attempt is streaming. */
export function Caret() {
	return (
		<span
			aria-hidden="true"
			className="animate-pulse motion-reduce:animate-none"
			style={{
				background: "var(--text-color-kumo-subtle)",
				display: "inline-block",
				flex: "0 0 auto",
				height: 12,
				width: 6,
			}}
		/>
	);
}
