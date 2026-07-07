import { defineConfig, type VariantProps } from "cva";
import { twMerge } from "tailwind-merge";

const variants = defineConfig({
	hooks: {
		onComplete: twMerge,
	},
});

export const { compose, cva, cx } = variants;
export type { VariantProps };
