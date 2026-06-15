import type { ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";

// Compound stat: a value paired with a label. Slots over props.
function StatRoot({ className, ...props }: ComponentPropsWithoutRef<"div">) {
	return (
		<div className={cn("flex items-baseline gap-1.5", className)} {...props} />
	);
}

function StatValue({ className, ...props }: ComponentPropsWithoutRef<"span">) {
	return (
		<span
			className={cn("text-sm tabular-nums text-foreground", className)}
			{...props}
		/>
	);
}

function StatLabel({ className, ...props }: ComponentPropsWithoutRef<"span">) {
	return (
		<span
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

export const Stat = Object.assign(StatRoot, {
	Root: StatRoot,
	Value: StatValue,
	Label: StatLabel,
});
