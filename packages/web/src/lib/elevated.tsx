import type { ComponentPropsWithoutRef, ReactNode, Ref } from "react";

import { surfaceClasses } from "@/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@/lib/surface-context";
import { cn } from "@/lib/utils";

interface ElevatedProps extends ComponentPropsWithoutRef<"div"> {
	/**
	 * Steps above the current substrate. The component's surface becomes
	 * `min(substrate + offset, 8)` and is re-provided to descendants, so further
	 * nesting walks up the ladder automatically. Conventional offsets:
	 * 2 — popover/menu, 4 — dialog/modal.
	 */
	offset: number;
	/** Pin the shadow weight independent of the computed surface level. */
	shadowLevel?: number;
	children?: ReactNode;
	ref?: Ref<HTMLDivElement>;
}

// React 19: ref is a plain prop, no forwardRef (per composition-patterns).
export function Elevated({
	offset,
	shadowLevel,
	className,
	children,
	ref,
	...props
}: ElevatedProps) {
	const substrate = useSurface();
	const level = Math.min(substrate + offset, 8);
	return (
		<SurfaceProvider value={level}>
			<div
				ref={ref}
				className={cn(surfaceClasses(level, shadowLevel ?? level), className)}
				{...props}
			>
				{children}
			</div>
		</SurfaceProvider>
	);
}
