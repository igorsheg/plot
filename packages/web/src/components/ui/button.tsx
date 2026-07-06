"use client";

import React from "react";
import { cn } from "../../lib/utils.js";

export const KUMO_BUTTON_VARIANTS = {
	shape: {
		base: { classes: "", description: "Default rectangular button shape" },
		square: {
			classes: "items-center justify-center p-0",
			description: "Square button for icon-only actions",
		},
		circle: {
			classes: "items-center justify-center p-0 rounded-full",
			description: "Circular button for icon-only actions",
		},
	},
	size: {
		xs: {
			classes: "h-5 gap-1 rounded-sm px-1.5 text-xs",
			description: "Extra small button for compact UIs",
		},
		sm: {
			classes: "h-6.5 gap-1 rounded-md px-2 text-xs",
			description: "Small button for secondary actions",
		},
		base: {
			classes: "h-9 gap-1.5 rounded-lg px-3 text-base",
			description: "Default button size",
		},
		lg: {
			classes: "h-10 gap-2 rounded-lg px-4 text-base",
			description: "Large button for primary CTAs",
		},
	},
	compactSize: {
		xs: { classes: "size-3.5" },
		sm: { classes: "size-6.5" },
		base: { classes: "size-9" },
		lg: { classes: "size-10" },
	},
	variant: {
		primary: {
			classes:
				"relative overflow-hidden bg-(--kumo-button-emphasis-bg) !text-white ring ring-(--kumo-button-emphasis-ring) focus:ring-(--kumo-button-emphasis-ring) focus-visible:ring-(--kumo-button-emphasis-ring) active:ring-(--kumo-button-emphasis-ring) disabled:opacity-50",
			description: "High-emphasis button for primary actions",
		},
		secondary: {
			classes:
				"bg-kumo-base !text-kumo-default ring not-disabled:hover:bg-kumo-tint disabled:bg-kumo-base/50 disabled:!text-kumo-default/70 ring-kumo-line data-[state=open]:bg-kumo-base",
			description: "Default button style for most actions",
		},
		ghost: {
			classes: "text-kumo-default hover:bg-kumo-tint shadow-none bg-inherit",
			description: "Minimal button with no background",
		},
		destructive: {
			classes:
				"relative overflow-hidden bg-(--kumo-button-emphasis-bg) !text-white ring ring-(--kumo-button-emphasis-ring) focus:ring-(--kumo-button-emphasis-ring) focus-visible:ring-(--kumo-button-emphasis-ring) active:ring-(--kumo-button-emphasis-ring) disabled:opacity-50",
			description: "Danger button for destructive actions",
		},
		"secondary-destructive": {
			classes:
				"bg-kumo-base !text-kumo-danger ring not-disabled:hover:!text-kumo-danger not-disabled:hover:ring-kumo-danger/30 disabled:bg-kumo-base/50 disabled:!text-kumo-danger/70 ring-kumo-line data-[state=open]:bg-kumo-base",
			description: "Secondary button with destructive text",
		},
		outline: {
			classes:
				"bg-transparent text-kumo-default ring ring-kumo-line transition-colors not-disabled:hover:text-kumo-strong not-disabled:hover:ring-kumo-focus/25",
			description: "Bordered button with transparent background",
		},
	},
} as const;

export const KUMO_BUTTON_DEFAULT_VARIANTS = {
	shape: "base",
	size: "base",
	variant: "secondary",
} as const;

export type KumoButtonShape = keyof typeof KUMO_BUTTON_VARIANTS.shape;
export type KumoButtonSize = keyof typeof KUMO_BUTTON_VARIANTS.size;
export type KumoButtonVariant = keyof typeof KUMO_BUTTON_VARIANTS.variant;
export type ButtonSize = KumoButtonSize | "default" | "icon";
export type ButtonVariant = KumoButtonVariant | "default";

export interface KumoButtonVariantsProps {
	readonly shape?: KumoButtonShape | undefined;
	readonly size?: ButtonSize | undefined;
	readonly variant?: ButtonVariant | undefined;
}

const resolveVariant = (
	variants: Record<string, { readonly classes: string }>,
	key: string | undefined,
	fallback: string,
): { readonly classes: string } =>
	variants[key ?? fallback] ?? variants[fallback] ?? { classes: "" };

const normalizeSize = (size: ButtonSize | undefined): KumoButtonSize =>
	size === undefined || size === "default" || size === "icon" ? "base" : size;

const normalizeVariant = (
	variant: ButtonVariant | undefined,
): KumoButtonVariant =>
	variant === undefined
		? KUMO_BUTTON_DEFAULT_VARIANTS.variant
		: variant === "default"
			? "primary"
			: variant;

const normalizeShape = (
	shape: KumoButtonShape | undefined,
	size: ButtonSize | undefined,
): KumoButtonShape =>
	shape ?? (size === "icon" ? "square" : KUMO_BUTTON_DEFAULT_VARIANTS.shape);

export function buttonVariants({
	variant,
	size,
	shape,
}: KumoButtonVariantsProps = {}) {
	const nextSize = normalizeSize(size);
	const nextShape = normalizeShape(shape, size);
	const nextVariant = normalizeVariant(variant);
	const isCompactShape = nextShape === "square" || nextShape === "circle";

	return cn(
		"group flex w-max shrink-0 items-center font-medium select-none",
		"border-0 shadow-xs",
		"focus:outline-none focus:ring-kumo-focus/50 focus-visible:ring-2 focus-visible:ring-kumo-brand",
		"cursor-pointer",
		"disabled:cursor-not-allowed disabled:text-kumo-subtle",
		resolveVariant(
			KUMO_BUTTON_VARIANTS.size,
			nextSize,
			KUMO_BUTTON_DEFAULT_VARIANTS.size,
		).classes,
		resolveVariant(
			KUMO_BUTTON_VARIANTS.shape,
			nextShape,
			KUMO_BUTTON_DEFAULT_VARIANTS.shape,
		).classes,
		isCompactShape &&
			resolveVariant(
				KUMO_BUTTON_VARIANTS.compactSize,
				nextSize,
				KUMO_BUTTON_DEFAULT_VARIANTS.size,
			).classes,
		resolveVariant(
			KUMO_BUTTON_VARIANTS.variant,
			nextVariant,
			KUMO_BUTTON_DEFAULT_VARIANTS.variant,
		).classes,
	);
}

type ButtonIcon =
	| React.ReactNode
	| React.ComponentType<Record<string, unknown>>
	| React.ElementType;

const renderIconNode = (icon: ButtonIcon | undefined): React.ReactNode => {
	if (icon === undefined || icon === null || icon === false) return null;
	if (React.isValidElement(icon)) return icon;
	return React.createElement(icon as React.ElementType);
};

const getEmphasisToken = (variant: KumoButtonVariant) => {
	if (variant === "primary") return "var(--color-kumo-brand)";
	if (variant === "destructive") return "var(--color-kumo-danger)";
	return undefined;
};

const getEmphasisStyle = (variant: KumoButtonVariant) => {
	const token = getEmphasisToken(variant);
	if (token === undefined) return undefined;
	return {
		"--kumo-button-emphasis-ring": `color-mix(in oklch, ${token}, black 10%)`,
		"--kumo-button-emphasis-bg": `color-mix(in oklch, ${token}, white 30%)`,
		"--kumo-button-emphasis-gradient-start": `color-mix(in oklch, ${token}, white 15%)`,
		"--kumo-button-emphasis-gradient-end": token,
	} satisfies React.CSSProperties & Record<`--${string}`, string>;
};

const renderSpinner = () => (
	<span
		aria-hidden="true"
		className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
	/>
);

const renderButtonContent = (
	variant: KumoButtonVariant,
	iconNode: React.ReactNode,
	children: React.ReactNode,
) => {
	const childNode =
		children === undefined || children === null ? null : (
			<span className="contents">{children}</span>
		);

	if (getEmphasisToken(variant) === undefined) {
		return (
			<>
				{iconNode}
				{childNode}
			</>
		);
	}

	return (
		<>
			<span
				aria-hidden="true"
				className="absolute inset-0 rounded-[inherit] bg-linear-to-b from-(--kumo-button-emphasis-gradient-start) to-(--kumo-button-emphasis-gradient-end) shadow-[inset_0_1px_0_0_var(--kumo-button-emphasis-bg)] group-hover:from-(--kumo-button-emphasis-bg)"
			/>
			<span className="relative flex items-center gap-1.5">
				{iconNode}
				{childNode}
			</span>
		</>
	);
};

type ButtonBaseProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
	readonly children?: React.ReactNode;
	readonly className?: string;
	readonly icon?: ButtonIcon;
	readonly loading?: boolean;
};

type ButtonWithTextProps = ButtonBaseProps & {
	readonly shape?: "base";
	readonly size?: ButtonSize;
	readonly variant?: ButtonVariant;
};

type IconOnlyButtonProps = ButtonBaseProps & {
	readonly "aria-label": string;
	readonly shape: "square" | "circle";
	readonly size?: ButtonSize;
	readonly variant?: ButtonVariant;
};

export type ButtonProps = ButtonWithTextProps | IconOnlyButtonProps;

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			children,
			className,
			disabled,
			icon,
			loading = false,
			shape = "base",
			size = "base",
			style,
			type,
			variant,
			...props
		},
		ref,
	) => {
		const nextVariant = normalizeVariant(variant);
		const emphasisStyle = getEmphasisStyle(nextVariant);
		const iconNode = loading ? renderSpinner() : renderIconNode(icon);
		return (
			<button
				ref={ref}
				className={cn(
					buttonVariants({ shape, size, variant }),
					disabled && "cursor-not-allowed opacity-50",
					className,
				)}
				data-kumo-component="Button"
				disabled={loading || disabled}
				style={emphasisStyle ? { ...emphasisStyle, ...style } : style}
				type={type ?? "button"}
				{...props}
			>
				{renderButtonContent(nextVariant, iconNode, children)}
			</button>
		);
	},
);

Button.displayName = "Button";
