import { cva } from "./ui/variants.js";

export const sessionMainClass = cva({
	base: "min-w-0 flex-1 pb-[var(--plot-page-bottom)] pl-[calc(var(--plot-rhythm)*20)] pr-[var(--plot-space-8)] pt-[var(--plot-page-top)]",
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
