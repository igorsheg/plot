import { cva } from "../ui/variants.js";

const motionVars =
	"[--dock-enter:140ms] [--dock-exit:90ms] [--dock-line:90ms] [--dock-ease-enter:cubic-bezier(0.16,1,0.3,1)] [--dock-ease-exit:cubic-bezier(0.7,0,0.84,0)]";

export const dockNavClass = cva({
	base: [
		"group/dock flex h-dvh w-[280px] flex-col items-start justify-center gap-3",
		motionVars,
	],
});

export const dockLineButtonClass = cva({
	base: "group/line relative flex cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left outline-none transition-[height] duration-[var(--dock-exit)] ease-[var(--dock-ease-exit)] group-hover/dock:duration-[var(--dock-enter)] group-hover/dock:ease-[var(--dock-ease-enter)] group-focus-within/dock:duration-[var(--dock-enter)] group-focus-within/dock:ease-[var(--dock-ease-enter)] after:absolute after:left-0 after:top-1/2 after:size-full after:-translate-y-1/2 after:p-4",
	variants: {
		visible: {
			false: "h-px group-hover/dock:h-5 group-focus-within/dock:h-5",
			true: "h-5",
		},
	},
});

export const dockLineClass = cva({
	base: "block h-px shrink-0 transition-colors duration-[80ms] ease-out",
	variants: {
		tone: {
			default:
				"bg-foreground/20 group-hover/line:bg-foreground group-focus-visible/line:bg-foreground group-aria-[current=page]/line:bg-foreground",
			attention:
				"bg-destructive/80 group-hover/line:bg-destructive group-focus-visible/line:bg-destructive group-aria-[current=page]/line:bg-destructive",
		},
	},
});

export const dockLineTitleShellClass = cva({
	base: "w-[220px] overflow-hidden whitespace-nowrap transition-[opacity,translate] duration-[var(--dock-exit)] ease-[var(--dock-ease-exit)] group-hover/dock:duration-[var(--dock-enter)] group-hover/dock:ease-[var(--dock-ease-enter)] group-focus-within/dock:duration-[var(--dock-enter)] group-focus-within/dock:ease-[var(--dock-ease-enter)]",
	variants: {
		visible: {
			false:
				"-translate-x-1 opacity-0 group-hover/dock:translate-x-0 group-hover/dock:opacity-100 group-focus-within/dock:translate-x-0 group-focus-within/dock:opacity-100",
			true: "translate-x-0 opacity-100",
		},
	},
});
