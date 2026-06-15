import type { ComponentPropsWithoutRef, Ref } from "react";

import { cn } from "@/lib/utils";

interface TableRootProps extends ComponentPropsWithoutRef<"div"> {
	ref?: Ref<HTMLDivElement>;
}

function TableRoot({ className, ref, ...props }: TableRootProps) {
	return (
		<div ref={ref} className={cn("overflow-x-auto", className)} {...props} />
	);
}

function TableElement({
	className,
	...props
}: ComponentPropsWithoutRef<"table">) {
	return (
		<table
			className={cn("w-full border-collapse text-left text-[12px]", className)}
			{...props}
		/>
	);
}

function TableHead({ className, ...props }: ComponentPropsWithoutRef<"thead">) {
	return (
		<thead className={cn("text-muted-foreground", className)} {...props} />
	);
}

function TableBody({ className, ...props }: ComponentPropsWithoutRef<"tbody">) {
	return (
		<tbody className={cn("divide-y divide-border", className)} {...props} />
	);
}

function TableRow({ className, ...props }: ComponentPropsWithoutRef<"tr">) {
	return <tr className={cn("align-top", className)} {...props} />;
}

function TableHeaderCell({
	className,
	...props
}: ComponentPropsWithoutRef<"th">) {
	return (
		<th
			className={cn("whitespace-nowrap px-3 py-2 font-medium", className)}
			{...props}
		/>
	);
}

function TableCell({ className, ...props }: ComponentPropsWithoutRef<"td">) {
	return <td className={cn("px-3 py-3", className)} {...props} />;
}

export const Table = Object.assign(TableRoot, {
	Element: TableElement,
	Head: TableHead,
	Body: TableBody,
	Row: TableRow,
	HeaderCell: TableHeaderCell,
	Cell: TableCell,
});
