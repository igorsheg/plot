/**
 * The board card: a kanban-style representation of a work item. It speaks the
 * same work-state vocabulary as the river row in work-item.tsx, but composes
 * the coss Frame panel surface instead of the flat list frame.
 */

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { Badge } from "../ui/badge.js";
import { framePanelClass } from "../ui/frame.js";
import type { Icon as IconGlyph, WorkState } from "../ui/icons.js";
import { Text, textVariants } from "../ui/text.js";
import { cva } from "../ui/variants.js";
import { StateIcon } from "./atoms.js";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const rootClass = cva({
	base: "min-w-0 list-none",
});

const frameClass = cva({
	base: "flex w-full flex-col text-left",
	variants: {
		interactive: {
			false: null,
			true: "cursor-pointer transition-shadow hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
		},
	},
});

const bodyClass = cva({
	base: "flex flex-col gap-1.5 p-4",
});

const tagsClass = cva({
	base: "flex flex-wrap items-center gap-1",
});

const tagClass = cva({
	base: "rounded-full px-2",
	variants: {
		tone: {
			neutral: null,
			info: "bg-info/10 text-info-foreground",
			success: "bg-success/10 text-success-foreground",
			warning: "bg-warning/10 text-warning-foreground",
			danger: "bg-destructive/10 text-destructive-foreground",
		},
	},
});

const lineClass = cva({
	base: "flex min-w-0 items-center gap-x-2",
});

const iconClass = cva({
	base: "inline-flex shrink-0",
});

const titleClass = cva({
	base: "min-w-0 flex-1",
});

const descriptionClass = cva({
	base: "m-0 line-clamp-2 min-w-0",
	variants: {
		tone: {
			secondary: textVariants({ variant: "secondary", size: "sm" }),
			error: textVariants({ variant: "error", size: "sm" }),
		},
	},
});

const footerClass = cva({
	base: "flex items-center justify-between gap-3 border-t border-border px-4 py-2.5",
});

const metaClass = cva({
	base: "flex min-w-0 items-center gap-3",
});

const countClass = cva({
	base: "inline-flex items-center gap-1",
});

const edgeClass = cva({
	base: "shrink-0 whitespace-nowrap",
});

export function Root({
	children,
	...props
}: Omit<HTMLAttributes<HTMLLIElement>, "className">): ReactNode {
	return (
		<li {...props} className={rootClass()} data-slot="work-card-root">
			{children}
		</li>
	);
}

export function Frame({
	children,
	interactive = false,
	open,
	onClick,
	...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "type"> & {
	readonly interactive?: boolean;
	readonly open?: boolean;
}): ReactNode {
	const className = framePanelClass({
		padding: "none",
		className: frameClass({ interactive }),
	});
	if (interactive) {
		return (
			<button
				{...props}
				aria-expanded={open}
				className={className}
				data-interactive=""
				data-open={open ? "" : undefined}
				data-slot="work-card-frame"
				onClick={onClick}
				type="button"
			>
				{children}
			</button>
		);
	}
	return (
		<div className={className} data-slot="work-card-frame">
			{children}
		</div>
	);
}

export function Body({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<div className={bodyClass()} data-slot="work-card-body">
			{children}
		</div>
	);
}

export function Tags({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<div className={tagsClass()} data-slot="work-card-tags">
			{children}
		</div>
	);
}

export function Tag({
	children,
	tone = "neutral",
}: {
	readonly children: ReactNode;
	readonly tone?: Tone;
}): ReactNode {
	return (
		<Badge className={tagClass({ tone })} data-slot="work-card-tag">
			{children}
		</Badge>
	);
}

export function Line({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<div className={lineClass()} data-slot="work-card-line">
			{children}
		</div>
	);
}

export function Icon({ state }: { readonly state: WorkState }): ReactNode {
	return (
		<span className={iconClass()} data-slot="work-card-icon" data-state={state}>
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
	readonly tone?: "body" | "secondary";
	readonly truncate?: boolean;
}): ReactNode {
	return (
		<span className={titleClass()} data-slot="work-card-title">
			<Text as="p" bold size="sm" truncate={truncate} variant={tone}>
				{children}
			</Text>
		</span>
	);
}

export function Description({
	children,
	tone = "secondary",
}: {
	readonly children: ReactNode;
	readonly tone?: "secondary" | "error";
}): ReactNode {
	return (
		<p className={descriptionClass({ tone })} data-slot="work-card-description">
			{children}
		</p>
	);
}

export function Footer({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<div className={footerClass()} data-slot="work-card-footer">
			{children}
		</div>
	);
}

export function Meta({
	children,
}: {
	readonly children?: ReactNode;
}): ReactNode {
	return (
		<div className={metaClass()} data-slot="work-card-meta">
			{children}
		</div>
	);
}

export function Count({
	icon: IconComponent,
	children,
}: {
	readonly icon: IconGlyph;
	readonly children: ReactNode;
}): ReactNode {
	return (
		<span className={countClass()} data-slot="work-card-count">
			<IconComponent
				aria-hidden
				className="size-3.5 shrink-0 text-muted-foreground"
			/>
			<Text as="span" size="sm" variant="secondary">
				{children}
			</Text>
		</span>
	);
}

export function Edge({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<span className={edgeClass()} data-slot="work-card-edge">
			<Text as="span" size="sm" variant="secondary">
				{children}
			</Text>
		</span>
	);
}

export const WorkCard = {
	Body,
	Count,
	Description,
	Edge,
	Footer,
	Frame,
	Icon,
	Line,
	Meta,
	Root,
	Tag,
	Tags,
	Title,
} as const;
