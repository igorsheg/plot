import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

// Page + section headings as defined primitives, so screens stop hand-rolling
// `<h1 className="text-3xl …">`. Type sizes come from the scale, never arbitrary.

export function PageHeader({
	title,
	subtitle,
	children,
}: {
	title: string;
	subtitle?: string;
	children?: ReactNode;
}) {
	return (
		<header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
			<div>
				<h1 className="text-3xl font-semibold tracking-[-0.03em]">{title}</h1>
				{subtitle ? (
					<p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
				) : null}
			</div>
			{children}
		</header>
	);
}

export function SectionLabel({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<h2 className={cn("text-xs font-medium text-muted-foreground", className)}>
			{children}
		</h2>
	);
}
