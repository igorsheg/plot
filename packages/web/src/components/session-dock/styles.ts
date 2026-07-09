import { cva } from "../ui/variants.js";

// The `--dock-*` custom properties these classes read are set inline on the nav
// from `DockMotion` (see motion.ts): one shared easing, an enter/exit duration
// pair. Every transition is gated behind prefers-reduced-motion so the line
// simply is, rather than animating, when the user asks for less motion.
export const dockNavClass = cva({
	base: "group/dock flex h-dvh w-fit max-w-[calc(100vw-2rem)] flex-col items-start justify-center gap-3 pr-3",
});

export const dockLineButtonClass = cva({
	base: "group/line relative flex cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left outline-none transition-[height] ease-[var(--dock-ease)] duration-[var(--dock-exit)] group-hover/dock:duration-[var(--dock-enter)] group-focus-within/dock:duration-[var(--dock-enter)] motion-reduce:transition-none after:absolute after:left-0 after:top-1/2 after:size-full after:-translate-y-1/2 after:p-4",
	variants: {
		visible: {
			false: "h-px group-hover/dock:h-5 group-focus-within/dock:h-5",
			true: "h-5",
		},
	},
});

export const dockLineClass = cva({
	base: "block h-px shrink-0 transition-[width,background-color] ease-[var(--dock-ease)] duration-[var(--dock-exit)] group-hover/line:duration-[var(--dock-enter)] group-focus-visible/line:duration-[var(--dock-enter)] motion-reduce:transition-none group-hover/line:w-[40px] group-focus-visible/line:w-[40px]",
	variants: {
		tone: {
			default:
				"bg-foreground/20 group-hover/line:bg-foreground group-focus-visible/line:bg-foreground group-aria-[current=page]/line:bg-foreground",
			attention:
				"bg-destructive/80 group-hover/line:bg-destructive group-focus-visible/line:bg-destructive group-aria-[current=page]/line:bg-destructive",
		},
		size: {
			normal: "w-[24px]",
			attention: "w-[32px]",
			active: "w-[40px]",
		},
	},
});

export const dockLineTitleShellClass = cva({
	base: "max-w-[220px] overflow-hidden whitespace-nowrap transition-[opacity,translate] ease-[var(--dock-ease)] duration-[var(--dock-exit)] group-hover/dock:duration-[var(--dock-enter)] group-focus-within/dock:duration-[var(--dock-enter)] motion-reduce:transition-none",
	variants: {
		visible: {
			false:
				"w-0 -translate-x-1 opacity-0 group-hover/dock:w-auto group-hover/dock:translate-x-0 group-hover/dock:opacity-100 group-focus-within/dock:w-auto group-focus-within/dock:translate-x-0 group-focus-within/dock:opacity-100",
			true: "w-auto translate-x-0 opacity-100",
		},
	},
});
