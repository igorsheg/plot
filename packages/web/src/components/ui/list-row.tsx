import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

// Compound list row: Leading / Body / Title / Subtitle / Trailing slots filled
// with children, never renderLeading/renderTrailing props
// (composition-patterns: patterns-children-over-render-props).
function ListRowRoot({ className, ...props }: ComponentPropsWithoutRef<"div">) {
	return (
		<div
			className={cn("flex items-center gap-3 py-2.5", className)}
			{...props}
		/>
	);
}

function ListRowLeading({
	className,
	...props
}: ComponentPropsWithoutRef<"div">) {
	return (
		<div className={cn("flex shrink-0 items-center", className)} {...props} />
	);
}

function ListRowBody({ className, ...props }: ComponentPropsWithoutRef<"div">) {
	return <div className={cn("min-w-0 flex-1", className)} {...props} />;
}

function ListRowTitle({ className, ...props }: ComponentPropsWithoutRef<"p">) {
	return (
		<p
			className={cn("truncate text-sm text-foreground", className)}
			{...props}
		/>
	);
}

function ListRowSubtitle({
	className,
	...props
}: ComponentPropsWithoutRef<"p">) {
	return (
		<p
			className={cn("truncate text-xs text-muted-foreground", className)}
			{...props}
		/>
	);
}

function ListRowTrailing({
	className,
	...props
}: ComponentPropsWithoutRef<"div">) {
	return (
		<div
			className={cn(
				"shrink-0 text-xs tabular-nums text-muted-foreground",
				className,
			)}
			{...props}
		/>
	);
}

export const ListRow = Object.assign(ListRowRoot, {
	Root: ListRowRoot,
	Leading: ListRowLeading,
	Body: ListRowBody,
	Title: ListRowTitle,
	Subtitle: ListRowSubtitle,
	Trailing: ListRowTrailing,
});
