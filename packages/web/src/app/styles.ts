import { cva } from "../components/ui/variants.js";

export const appShellClass = cva({
	base: "h-dvh overflow-hidden bg-background text-foreground",
});

export const dockAnchorClass = cva({
	base: "fixed left-0 top-1/2 z-40 -translate-y-1/2 pl-[var(--plot-space-4)]",
});

export const themeAnchorClass = cva({
	base: "fixed left-[var(--plot-space-4)] top-[var(--plot-space-4)] z-40",
});
