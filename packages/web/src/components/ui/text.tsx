"use client";

import React, {
	type CSSProperties,
	type ComponentPropsWithoutRef,
	type ElementRef,
	type ForwardedRef,
	forwardRef,
	useMemo,
} from "react";
import { cn } from "../../lib/utils.js";

export const KUMO_TEXT_VARIANTS = {
	variant: {
		heading1: {
			classes: "text-3xl font-semibold",
			description: "Large heading for page titles",
		},
		heading2: {
			classes: "text-2xl font-semibold",
			description: "Medium heading for section titles",
		},
		heading3: {
			classes: "text-lg font-semibold",
			description: "Small heading for subsections",
		},
		body: {
			classes: "text-kumo-default",
			description: "Default body text",
		},
		secondary: {
			classes: "text-kumo-subtle",
			description: "Muted text for secondary information",
		},
		success: {
			classes: "text-kumo-link",
			description: "Success state text",
		},
		error: {
			classes: "text-kumo-danger",
			description: "Error state text",
		},
		mono: {
			classes: "font-mono",
			description: "Monospace text for code",
		},
		"mono-secondary": {
			classes: "font-mono text-kumo-subtle",
			description: "Muted monospace text",
		},
	},
	size: {
		xs: { classes: "text-xs", description: "Extra small text" },
		sm: { classes: "text-sm", description: "Small text" },
		base: { classes: "text-base", description: "Default text size" },
		lg: { classes: "text-lg", description: "Large text" },
	},
} as const;

export const KUMO_TEXT_DEFAULT_VARIANTS = {
	variant: "body",
	size: "base",
} as const;

export const KUMO_TEXT_STYLING = {
	fontSizes: {
		xs: 12,
		sm: 14,
		base: 16,
		lg: 18,
		xl: 20,
		"2xl": 24,
		"3xl": 30,
	},
	fontWeights: {
		normal: 400,
		medium: 500,
		semibold: 600,
	},
	baseColor: "text-kumo-default",
	variantColors: {
		body: "text-kumo-default",
		secondary: "text-kumo-subtle",
		success: "text-kumo-link",
		error: "text-kumo-danger",
		mono: "text-kumo-default",
		"mono-secondary": "text-kumo-subtle",
	},
	fontFamilies: {
		default: "sans-serif",
		mono: "monospace",
	},
} as const;

export type KumoTextVariant = keyof typeof KUMO_TEXT_VARIANTS.variant;
export type KumoTextSize = keyof typeof KUMO_TEXT_VARIANTS.size;

export interface KumoTextVariantsProps {
	readonly variant?: KumoTextVariant | undefined;
	readonly size?: KumoTextSize | undefined;
}

const resolveVariant = (
	variants: Record<string, { readonly classes: string }>,
	key: string | undefined,
	fallback: string,
): { readonly classes: string } =>
	variants[key ?? fallback] ?? variants[fallback] ?? { classes: "" };

export function textVariants({
	variant = KUMO_TEXT_DEFAULT_VARIANTS.variant,
	size = KUMO_TEXT_DEFAULT_VARIANTS.size,
}: KumoTextVariantsProps = {}) {
	return cn(
		resolveVariant(
			KUMO_TEXT_VARIANTS.variant,
			variant,
			KUMO_TEXT_DEFAULT_VARIANTS.variant,
		).classes,
		resolveVariant(
			KUMO_TEXT_VARIANTS.size,
			size,
			KUMO_TEXT_DEFAULT_VARIANTS.size,
		).classes,
	);
}

type Heading = "heading1" | "heading2" | "heading3";
type Copy = "body" | "secondary" | "success" | "error";
type Monospace = "mono" | "mono-secondary";
type TextSize = KumoTextSize;
type TextVariant = KumoTextVariant;

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
	"className" | "style"
> & {
	readonly DANGEROUS_className?: string;
	readonly DANGEROUS_style?: CSSProperties;
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
					readonly size?: "lg";
					readonly truncate?: boolean;
					readonly variant?: Variant;
				}
			: Variant extends Heading
				? {
						readonly as: TextElement;
						readonly bold?: never;
						readonly size?: never;
						readonly truncate?: boolean;
						readonly variant: Variant;
					}
				: never);

export interface TextProps {
	readonly as?: TextElement;
	readonly bold?: boolean;
	readonly children?: React.ReactNode;
	readonly size?: KumoTextSize;
	readonly truncate?: boolean;
	readonly variant?: KumoTextVariant;
}

function TextRoot<Variant extends TextVariant = "body">(
	{
		as,
		bold = false,
		children,
		DANGEROUS_className,
		DANGEROUS_style,
		size = "base",
		truncate = false,
		variant = "body" as Variant,
		...props
	}: TextPropsInternal<Variant>,
	ref: ForwardedRef<HTMLElement>,
) {
	const isCopy = ["body", "secondary", "success", "error"].includes(variant);
	const isMono = ["mono", "mono-secondary"].includes(variant);
	const Component = useMemo(() => {
		if (as) return as;
		if (["mono", "mono-secondary"].includes(variant)) return "span";
		if (["heading1", "heading2", "heading3"].includes(variant)) return "span";
		return "p";
	}, [as, variant]);

	return (
		<Component
			ref={ref as React.RefCallback<HTMLElement>}
			className={cn(
				"text-kumo-default",
				resolveVariant(
					KUMO_TEXT_VARIANTS.variant,
					variant,
					KUMO_TEXT_DEFAULT_VARIANTS.variant,
				).classes,
				isCopy
					? resolveVariant(
							KUMO_TEXT_VARIANTS.size,
							size,
							KUMO_TEXT_DEFAULT_VARIANTS.size,
						).classes
					: "",
				isCopy && bold ? "font-medium" : "",
				isMono &&
					(size === "lg"
						? KUMO_TEXT_VARIANTS.size.base.classes
						: KUMO_TEXT_VARIANTS.size.sm.classes),
				truncate && "truncate min-w-0",
				DANGEROUS_className,
			)}
			style={DANGEROUS_style}
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
) => React.ReactElement;
