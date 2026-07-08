import { cva } from "../ui/variants.js";
import { textVariants } from "../ui/text.js";

export const groupClass = cva({
	base: "m-0 list-none p-0",
});

export const hairlineClass = cva({
	base: "border-t border-border",
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
