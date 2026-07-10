import type { HTMLAttributes, ReactElement } from "react";
import { cn } from "../../lib/utils.js";

export function Badge({
	className,
	...props
}: HTMLAttributes<HTMLSpanElement>): ReactElement {
	return (
		<span
			className={cn(
				"relative inline-flex h-5.5 min-w-5.5 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent bg-secondary px-[calc(--spacing(1)-1px)] font-medium text-secondary-foreground text-sm outline-none sm:h-4.5 sm:min-w-4.5 sm:text-xs",
				className,
			)}
			{...props}
		/>
	);
}
