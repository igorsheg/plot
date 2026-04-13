import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";

import { cn } from "../lib/utils";

type TabsVariant = "default" | "underline";

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
	return (
		<TabsPrimitive.Root
			className={cn("flex flex-col gap-2 data-[orientation=vertical]:flex-row", className)}
			data-slot="tabs"
			{...props}
		/>
	);
}

function TabsList({
	variant = "default",
	className,
	children,
	...props
}: TabsPrimitive.List.Props & {
	variant?: TabsVariant;
}) {
	return (
		<TabsPrimitive.List
			className={cn(
				"relative z-0 flex w-fit items-center justify-center gap-x-0.5 text-muted-foreground",
				"data-[orientation=vertical]:flex-col",
				variant === "default"
					? "rounded-lg bg-muted p-0.5 text-muted-foreground/72"
					: "data-[orientation=vertical]:px-1 data-[orientation=horizontal]:py-1 *:data-[slot=tabs-tab]:hover:bg-accent",
				className,
			)}
			data-slot="tabs-list"
			{...props}
		>
			{children}
			<TabsPrimitive.Indicator
				className={cn(
					"-translate-y-(--active-tab-bottom) absolute bottom-0 left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) transition-[width,translate] duration-200 ease-in-out",
					variant === "underline"
						? "data-[orientation=vertical]:-translate-x-px z-10 bg-primary data-[orientation=horizontal]:h-0.5 data-[orientation=vertical]:w-0.5 data-[orientation=horizontal]:translate-y-px"
						: "-z-1 rounded-md bg-background shadow-sm/5 dark:bg-input",
				)}
				data-slot="tab-indicator"
			/>
		</TabsPrimitive.List>
	);
}

type TabsTabSize = "default" | "sm" | "xs";

const tabSizeClasses: Record<TabsTabSize, string> = {
	default:
		"h-9 px-[calc(--spacing(2.5)-1px)] text-base sm:h-8 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
	sm: "h-7 px-[calc(--spacing(2)-1px)] text-sm sm:h-6 sm:text-xs [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
	xs: "h-6 px-[calc(--spacing(1.5)-1px)] text-xs sm:h-5 sm:text-[0.625rem] [&_svg:not([class*='size-'])]:size-3.5 sm:[&_svg:not([class*='size-'])]:size-3",
};

function TabsTab({
	className,
	size = "default",
	...props
}: TabsPrimitive.Tab.Props & { size?: TabsTabSize }) {
	return (
		<TabsPrimitive.Tab
			className={cn(
				"[&_svg]:-mx-0.5 relative flex shrink-0 grow cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent font-medium outline-none transition-[color,background-color,box-shadow] hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring data-disabled:pointer-events-none data-[orientation=vertical]:w-full data-[orientation=vertical]:justify-start data-active:text-foreground data-disabled:opacity-64 [&_svg]:pointer-events-none [&_svg]:shrink-0",
				tabSizeClasses[size],
				className,
			)}
			data-slot="tabs-tab"
			{...props}
		/>
	);
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
	return (
		<TabsPrimitive.Panel
			className={cn("flex-1 outline-none", className)}
			data-slot="tabs-content"
			{...props}
		/>
	);
}

export {
	Tabs,
	TabsList,
	TabsTab,
	TabsTab as TabsTrigger,
	TabsPanel,
	TabsPanel as TabsContent,
	TabsPrimitive,
};
