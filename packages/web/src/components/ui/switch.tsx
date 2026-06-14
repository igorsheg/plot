"use client";

import { Switch as BaseSwitch } from "@base-ui/react/switch";
import * as React from "react";

import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
	React.ElementRef<typeof BaseSwitch.Root>,
	React.ComponentPropsWithoutRef<typeof BaseSwitch.Root>
>(({ className, ...props }, ref) => (
	<BaseSwitch.Root
		className={cn(
			"peer focus-visible:ring-ring focus-visible:ring-offset-background data-checked:bg-primary bg-input inline-flex h-4 w-6 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
			className,
		)}
		{...props}
		ref={ref}
	>
		<BaseSwitch.Thumb
			className={cn(
				"bg-background pointer-events-none block h-3 w-3 rounded-full shadow-lg ring-0 transition-transform data-checked:translate-x-2",
			)}
		/>
	</BaseSwitch.Root>
));
Switch.displayName = "Switch";

export { Switch };
