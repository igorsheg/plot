import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import type { WorkState } from "../ui/icons.js";
import { Text, type TextVariant, textVariants } from "../ui/text.js";
import { cva } from "../ui/variants.js";
import { StateIcon } from "./atoms.js";

type Density = "work" | "settled";
type Tone = Extract<TextVariant, "body" | "secondary" | "error">;

const rootClass = cva({
	base: "min-w-0 list-none",
});

const frameClass = cva({
	base: "flex w-full flex-col gap-y-1 rounded-lg border-0 bg-transparent text-left",
	variants: {
		density: {
			work: "p-2",
			settled: "px-2 py-1",
		},
		interactive: {
			false: null,
			true: "cursor-pointer hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
		},
	},
});

// The title line: baseline-aligns its text so the edge time rests on the
// title's baseline; the icon opts out and centres on the line instead.
const lineClass = cva({
	base: "flex min-w-0 items-baseline gap-x-3",
});

// The icon lane: `self-center` centres the glyph on the title's line box; the
// 1px downward nudge is an optical correction that seats it on the title text.
const iconClass = cva({
	base: "inline-flex shrink-0 translate-y-px self-center",
});

const titleClass = cva({
	base: "min-w-0 flex-1",
});

// `ps-7` = the icon lane (size-4) + the line gap (gap-x-3), so the subline
// aligns under the title rather than under the icon.
const sublineClass = cva({
	base: "block h-5 min-w-0 truncate ps-7",
	variants: {
		tone: {
			body: textVariants({ size: "sm" }),
			secondary: textVariants({ variant: "secondary", size: "sm" }),
			error: textVariants({ variant: "error", size: "sm" }),
		},
	},
});

const edgeClass = cva({
	base: "shrink-0 whitespace-nowrap",
});

const labelClass = cva({
	base: "shrink-0",
});

const messageClass = cva({
	base: ["min-w-0 flex-1 truncate", textVariants({ size: "sm" })],
});

export function Root({
	children,
	...props
}: Omit<HTMLAttributes<HTMLLIElement>, "className">): ReactNode {
	return (
		<li {...props} className={rootClass()} data-slot="work-item-root">
			{children}
		</li>
	);
}

export function Frame({
	children,
	density = "work",
	interactive = false,
	open,
	onClick,
	...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "type"> & {
	readonly density?: Density;
	readonly interactive?: boolean;
	readonly open?: boolean;
}): ReactNode {
	const className = frameClass({ density, interactive });
	if (interactive) {
		return (
			<button
				{...props}
				aria-expanded={open}
				className={className}
				data-density={density}
				data-interactive=""
				data-open={open ? "" : undefined}
				data-slot="work-item-frame"
				onClick={onClick}
				type="button"
			>
				{children}
			</button>
		);
	}
	return (
		<div
			className={className}
			data-density={density}
			data-slot="work-item-frame"
		>
			{children}
		</div>
	);
}

export function Line({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<div className={lineClass()} data-slot="work-item-line">
			{children}
		</div>
	);
}

export function Icon({ state }: { readonly state: WorkState }): ReactNode {
	return (
		<span className={iconClass()} data-slot="work-item-icon" data-state={state}>
			<StateIcon state={state} />
		</span>
	);
}

export function Title({
	children,
	tone = "body",
	truncate = false,
}: {
	readonly children: ReactNode;
	readonly tone?: Tone;
	readonly truncate?: boolean;
}): ReactNode {
	return (
		<span className={titleClass()} data-slot="work-item-title">
			<Text as="p" truncate={truncate} variant={tone}>
				{children}
			</Text>
		</span>
	);
}

export function Subline({
	children,
	empty = false,
	tone = "body",
}: {
	readonly children?: ReactNode;
	readonly empty?: boolean;
	readonly tone?: Tone;
}): ReactNode {
	return (
		<span
			aria-hidden={empty || undefined}
			className={sublineClass({ tone })}
			data-empty={empty ? "" : undefined}
			data-slot="work-item-subline"
		>
			{empty ? " " : children}
		</span>
	);
}

export function Edge({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<span className={edgeClass()} data-slot="work-item-edge">
			<Text as="span" size="sm" variant="secondary">
				{children}
			</Text>
		</span>
	);
}

export function Label({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<span className={labelClass()} data-slot="work-item-label">
			<Text as="span">{children}</Text>
		</span>
	);
}

export function Message({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<span className={messageClass()} data-slot="work-item-message">
			{children}
		</span>
	);
}

export const WorkItem = {
	Edge,
	Frame,
	Icon,
	Label,
	Line,
	Message,
	Root,
	Subline,
	Title,
} as const;
