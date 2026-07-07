/**
 * Tiny presentational atoms shared by the river rows and the detail drawer: the
 * status dot (one vocabulary) and the streaming caret. Kept here (not in
 * `session-work.tsx`) so the drawer can reuse them without an import cycle.
 */

import { cva } from "../ui/variants.js";

export type DotKind = "active" | "queued" | "attention" | "done";

export const dotClass = cva({
	base: "size-2 shrink-0 rounded-full",
	variants: {
		kind: {
			active: "bg-foreground",
			queued:
				"bg-transparent shadow-[inset_0_0_0_1.5px_var(--muted-foreground)]",
			attention: "bg-destructive",
			done: "bg-muted-foreground",
		},
		offset: {
			false: null,
			true: "mt-2",
		},
	},
	defaultVariants: {
		offset: false,
	},
});

export function Dot({ kind }: { readonly kind: DotKind }) {
	return (
		<span aria-hidden="true" className={dotClass({ kind, offset: true })} />
	);
}

/** Blinking stream caret — rendered only while an attempt is streaming. */
export function Caret() {
	return (
		<span
			aria-hidden="true"
			className="inline-block h-3 w-1.5 shrink-0 animate-pulse bg-muted-foreground motion-reduce:animate-none"
		/>
	);
}
