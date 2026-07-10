"use client";

import type {
	ComponentPropsWithoutRef,
	ElementType,
	ReactElement,
	ReactNode,
	Ref,
} from "react";
import { cva } from "./variants.js";

export const TEXT_VARIANTS = {
	variant: {
		heading1:
			"font-heading text-3xl leading-9 font-semibold tracking-tight text-foreground",
		heading2:
			"font-heading text-2xl leading-8 font-semibold tracking-tight text-foreground",
		heading3:
			"font-heading text-lg leading-7 font-semibold tracking-tight text-foreground",
		body: "text-foreground",
		secondary: "text-muted-foreground",
		success: "text-success-foreground",
		error: "text-destructive-foreground",
		mono: "font-mono text-foreground",
		"mono-secondary": "font-mono text-muted-foreground",
		"mono-error": "font-mono text-destructive-foreground",
		label:
			"font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground",
	},
	size: {
		xs: "text-xs leading-4",
		sm: "text-sm leading-5",
		base: "text-base leading-6",
		lg: "text-lg leading-7",
		subline: "text-[13.5px] leading-[18px]",
	},
} as const;

export const TEXT_DEFAULT_VARIANTS = {
	variant: "body",
	size: "base",
} as const;

export type TextVariant = keyof typeof TEXT_VARIANTS.variant;
export type TextSize = keyof typeof TEXT_VARIANTS.size;

export interface TextVariantsProps {
	readonly variant?: TextVariant | undefined;
	readonly size?: TextSize | undefined;
}

const textClass = cva({ variants: TEXT_VARIANTS });

export function textVariants({
	variant = TEXT_DEFAULT_VARIANTS.variant,
	size = TEXT_DEFAULT_VARIANTS.size,
}: TextVariantsProps = {}) {
	return textClass({ variant, size });
}

export type TextElement = "h1" | "h2" | "h3" | "p" | "span";

export interface TextProps extends Omit<
	ComponentPropsWithoutRef<"span">,
	"children" | "className" | "style"
> {
	readonly as?: TextElement;
	readonly bold?: boolean;
	readonly children?: ReactNode;
	readonly ref?: Ref<HTMLElement>;
	readonly size?: TextSize;
	readonly truncate?: boolean;
	readonly variant?: TextVariant;
}

const defaultElement = (variant: TextVariant): TextElement =>
	variant === "heading1"
		? "h1"
		: variant === "heading2"
			? "h2"
			: variant === "heading3"
				? "h3"
				: variant === "body" ||
					  variant === "secondary" ||
					  variant === "success" ||
					  variant === "error"
					? "p"
					: "span";

export function Text({
	as,
	bold = false,
	children,
	ref,
	size = "base",
	truncate = false,
	variant = "body",
	...props
}: TextProps): ReactElement {
	const Component = (as ?? defaultElement(variant)) as ElementType;
	const sized = !variant.startsWith("heading") && variant !== "label";
	return (
		<Component
			ref={ref}
			className={textClass({
				variant,
				size: sized ? size : undefined,
				className: [bold && "font-medium", truncate && "min-w-0 truncate"],
			})}
			{...props}
		>
			{children}
		</Component>
	);
}
