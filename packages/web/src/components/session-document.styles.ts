import { cva } from "./ui/variants.js";

/** The session body: document column + detail column, side by side. */
export const sessionSplitClass = cva({
	base: "flex h-full min-w-0 flex-1 overflow-hidden",
});

export const sessionMainClass = cva({
	base: "min-w-0 flex-1 overflow-hidden pl-[calc(var(--plot-rhythm)*20)]",
});

export const sessionBoardMainClass = cva({
	base: "min-w-0 flex-1 overflow-hidden",
});

export const sessionDocumentClass = cva({
	base: "mx-auto w-full max-w-[calc(var(--plot-rhythm)*208)]",
	variants: {
		state: {
			empty: "min-h-[calc(var(--plot-rhythm)*128)]",
			loaded: null,
		},
	},
	defaultVariants: {
		state: "loaded",
	},
});

/** The detail column — an animating-width sibling, not a floating sheet. */
export const sessionDetailClass = cva({
	base: "shrink-0 overflow-hidden",
});

/** Fixed-width inner so the content never reflows as the column reveals it. */
export const sessionDetailInnerClass = cva({
	base: "h-full border-border border-l",
});
