/** Shared work-state dot vocabulary used by the river and detail drawer. */

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
