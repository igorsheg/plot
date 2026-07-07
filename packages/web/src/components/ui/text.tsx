"use client";

import {
	type ComponentPropsWithoutRef,
	type ElementRef,
	type ForwardedRef,
	forwardRef,
	type ReactElement,
	type ReactNode,
	type RefCallback,
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

const textClass = cva({
	variants: TEXT_VARIANTS,
});

export function textVariants({
	variant = TEXT_DEFAULT_VARIANTS.variant,
	size = TEXT_DEFAULT_VARIANTS.size,
}: TextVariantsProps = {}) {
	return textClass({ variant, size });
}

type Heading = "heading1" | "heading2" | "heading3";
type Copy = "body" | "secondary" | "success" | "error";
type Monospace = "mono" | "mono-secondary" | "mono-error";
type Label = "label";

export type TextElement =
	| "h1"
	| "h2"
	| "h3"
	| "h4"
	| "h5"
	| "h6"
	| "p"
	| "span"
	| "label"
	| "dt"
	| "dd"
	| "li"
	| "figcaption"
	| "legend"
	| "pre"
	| "code"
	| "em"
	| "strong"
	| "small"
	| "abbr"
	| "time";

type BaseTextProps = Omit<
	ComponentPropsWithoutRef<"span">,
	"children" | "className" | "style"
> & {
	readonly children?: ReactNode;
};

type TextPropsInternal<Variant extends TextVariant = "body"> = BaseTextProps &
	(Variant extends Copy
		? {
				readonly as?: TextElement;
				readonly bold?: boolean;
				readonly size?: TextSize;
				readonly truncate?: boolean;
				readonly variant?: Variant;
			}
		: Variant extends Monospace
			? {
					readonly as?: TextElement;
					readonly bold?: never;
					readonly size?: TextSize;
					readonly truncate?: boolean;
					readonly variant?: Variant;
				}
			: Variant extends Heading | Label
				? {
						readonly as?: TextElement;
						readonly bold?: never;
						readonly size?: never;
						readonly truncate?: boolean;
						readonly variant: Variant;
					}
				: never);

export interface TextProps {
	readonly as?: TextElement;
	readonly bold?: boolean;
	readonly children?: ReactNode;
	readonly size?: TextSize;
	readonly truncate?: boolean;
	readonly variant?: TextVariant;
}

const defaultElement = (variant: TextVariant): TextElement => {
	if (variant === "heading1") return "h1";
	if (variant === "heading2") return "h2";
	if (variant === "heading3") return "h3";
	if (
		variant === "mono" ||
		variant === "mono-secondary" ||
		variant === "mono-error"
	)
		return "span";
	if (variant === "label") return "span";
	return "p";
};

function TextRoot<Variant extends TextVariant = "body">(
	{
		as,
		bold = false,
		children,
		size = "base",
		truncate = false,
		variant = "body" as Variant,
		...props
	}: TextPropsInternal<Variant>,
	ref: ForwardedRef<HTMLElement>,
) {
	const Component = as ?? defaultElement(variant);
	const sized = !["heading1", "heading2", "heading3", "label"].includes(
		variant,
	);

	return (
		<Component
			ref={ref as RefCallback<HTMLElement>}
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

export const Text = forwardRef(TextRoot) as <
	Variant extends TextVariant = "body",
>(
	props: TextPropsInternal<Variant> & {
		readonly ref?: ForwardedRef<ElementRef<"span">>;
	},
) => ReactElement;
