import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";

import { cn } from "../lib/utils";

function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
	return (
		<RadioGroupPrimitive
			className={cn("flex flex-col gap-3", className)}
			data-slot="radio-group"
			{...props}
		/>
	);
}

function Radio({
	className,
	size = "default",
	...props
}: RadioPrimitive.Root.Props & { size?: "default" | "xs" }) {
	return (
		<RadioPrimitive.Root
			className={cn(
				"relative inline-flex shrink-0 items-center justify-center rounded-full border border-input bg-background not-dark:bg-clip-padding shadow-xs/5 outline-none transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-full not-data-disabled:not-data-checked:not-aria-invalid:before:shadow-[0_1px_--theme(--color-black/4%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/48 data-disabled:opacity-64 dark:not-data-checked:bg-input/32 dark:aria-invalid:ring-destructive/24 dark:not-data-disabled:not-data-checked:not-aria-invalid:before:shadow-[0_-1px_--theme(--color-white/6%)] [[data-disabled],[data-checked],[aria-invalid]]:shadow-none",
				size === "xs" ? "size-3.5 sm:size-3" : "size-4.5 sm:size-4",
				className,
			)}
			data-slot="radio"
			data-size={size}
			{...props}
		>
			<RadioPrimitive.Indicator
				className={cn(
					"-inset-px absolute flex items-center justify-center rounded-full before:rounded-full before:bg-primary-foreground data-unchecked:hidden data-checked:bg-primary",
					size === "xs"
						? "size-3.5 before:size-1.5 sm:size-3 sm:before:size-1"
						: "size-4.5 before:size-2 sm:size-4 sm:before:size-1.5",
				)}
				data-slot="radio-indicator"
			/>
		</RadioPrimitive.Root>
	);
}

export {
	RadioGroup,
	Radio,
	Radio as RadioGroupItem,
	RadioGroupPrimitive,
	RadioPrimitive,
};
