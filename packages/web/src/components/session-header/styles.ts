import { cva } from "../ui/variants.js";
import { textVariants } from "../ui/text.js";

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
