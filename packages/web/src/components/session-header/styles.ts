import { cva } from "../ui/variants.js";
import { textVariants } from "../ui/text.js";

export const ghostStripClass = cva({
	base: "relative h-10 opacity-25",
});

export const ghostStripLineClass = cva({
	base: "absolute inset-x-0 top-[19px] h-[1.5px] bg-muted-foreground",
});

export const sparklineRootClass = cva({
	base: [
		"inline-flex items-center whitespace-nowrap",
		textVariants({ variant: "secondary", size: "sm" }),
	],
});

export const sparklineClass = cva({
	base: "inline-flex h-10 items-end gap-px align-middle",
});

export const sparklineBucketClass = cva({
	base: "inline-block w-[5px] bg-current will-change-[height,opacity]",
});
