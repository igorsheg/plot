import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Text, type TextVariant, textVariants } from "../ui/text.js";
import { cva } from "../ui/variants.js";
import { dotClass, type DotKind } from "./atoms.js";

type Density = "work" | "settled";
type Tone = Extract<TextVariant, "body" | "secondary" | "error">;

const rootClass = cva({
	base: "min-w-0 list-none",
});

const frameClass = cva({
	base: "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] rounded-lg border-0 bg-transparent text-left",
	variants: {
		density: {
			work: "items-start gap-x-3 p-2",
			settled: "items-center gap-x-3 px-2 py-1",
		},
		interactive: {
			false: null,
			true: "cursor-pointer hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
		},
	},
});

const bodyClass = cva({
	base: "grid min-w-0 grid-rows-[auto_--spacing(5)] gap-y-1",
});

const sublineClass = cva({
	base: "block h-5 min-w-0 max-w-full truncate",
	variants: {
		tone: {
			body: textVariants({ size: "sm" }),
			secondary: textVariants({ variant: "secondary", size: "sm" }),
			error: textVariants({ variant: "error", size: "sm" }),
		},
	},
});

const edgeClass = cva({
	base: "whitespace-nowrap",
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

export function Dot({ kind }: { readonly kind: DotKind }): ReactNode {
	return (
		<span
			aria-hidden="true"
			className={dotClass({ kind, offset: true })}
			data-kind={kind}
			data-slot="work-item-dot"
		/>
	);
}

export function Body({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<div className={bodyClass()} data-slot="work-item-body">
			{children}
		</div>
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
		<Text as="p" data-slot="work-item-title" truncate={truncate} variant={tone}>
			{children}
		</Text>
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
			{empty ? "\u00A0" : children}
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
	Body,
	Dot,
	Edge,
	Frame,
	Label,
	Message,
	Root,
	Subline,
	Title,
} as const;
