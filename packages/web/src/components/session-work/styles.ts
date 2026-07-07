import { cva } from "../ui/variants.js";
import { textVariants } from "../ui/text.js";

export const riverClass = cva({
	base: "w-full",
});

export const groupClass = cva({
	base: "m-0 list-none gap-[18px] p-0",
});

export const itemClass = cva({
	base: "min-w-0 list-none",
});

export const rowClass = cva({
	base: "min-w-0",
	variants: {
		size: {
			work: "h-14",
			settled: "h-8",
			subline: "h-5",
			content: null,
		},
	},
	defaultVariants: {
		size: "content",
	},
});

export const edgeClass = cva({
	base: "whitespace-nowrap",
});

export const hairlineClass = cva({
	base: "border-t border-border",
});

export const openButtonClass = cva({
	base: "group -mx-2 flex w-full cursor-pointer rounded-md px-2 py-1 text-left hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
	variants: {
		align: {
			work: "items-start gap-3",
			settled: "items-baseline gap-3",
		},
	},
});

export const workLineClass = cva({
	base: "block h-5 min-w-0 max-w-full truncate",
	variants: {
		kind: {
			empty: null,
			live: textVariants({ size: "sm" }),
			reason: textVariants({ size: "sm" }),
		},
		fill: {
			false: null,
			true: "flex-1",
		},
	},
	defaultVariants: {
		fill: false,
		kind: "live",
	},
});

export const settledLineClass = cva({
	base: ["min-w-0 flex-1 truncate", textVariants({ size: "sm" })],
});

export const drawerHeaderRowClass = cva({
	base: "min-w-0",
});

export const drawerBodyClass = cva({
	base: "min-h-0 flex-1 overflow-y-auto p-6 pt-1 [scrollbar-gutter:stable]",
});

export const drawerFooterClass = cva({
	base: "w-full",
});

export const nowrapClass = cva({
	base: "whitespace-nowrap",
});

export const preWrapClass = cva({
	base: "m-0 min-w-0 whitespace-pre-wrap break-words",
});

export const timelineListClass = cva({
	base: "m-0 list-none p-0",
});

export const timelineRowClass = cva({
	base: "min-w-0",
});

export const timelineLabelClass = cva({
	base: "shrink-0 grow-0 basis-[42px] text-right",
});

export const timelineTextClass = cva({
	base: "min-w-0 flex-1",
});

export const transcriptEntryBodyClass = cva({
	base: "min-w-0 flex-1",
});

export const transcriptToggleClass = cva({
	base: [
		"w-max cursor-pointer rounded bg-transparent text-left hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
		textVariants({ variant: "secondary", size: "sm" }),
	],
});

export const decisionActionsClass = cva({
	base: "pt-1",
});

export const decisionCommentInputClass = cva({
	base: [
		"h-7 min-w-40 rounded-md bg-transparent px-2 ring ring-input focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
		textVariants({ size: "sm" }),
	],
});
