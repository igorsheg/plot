/**
 * Port of the coss-ui Tabs primitive on `@base-ui/react/tabs`, restyled for the
 * Workflow band: no muted track, the selected Workflow is a bordered chip on
 * the page ground and the sliding `Indicator` carries that chip. Layout is a
 * separate app-level toggle; these tabs only select content.
 */

"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import type { ReactElement } from "react";
import { cva } from "./variants.js";

const tabsClass = cva({
	base: "flex flex-col gap-2 data-[orientation=vertical]:flex-row",
});

const tabsListClass = cva({
	base: "relative z-0 flex w-fit items-center gap-x-1 text-muted-foreground data-[orientation=vertical]:flex-col",
});

const tabsTabClass = cva({
	base: "relative flex h-9 shrink-0 grow cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-transparent px-[calc(--spacing(2.5)-1px)] font-medium text-base outline-none transition-[color,background-color,box-shadow] hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring data-disabled:pointer-events-none data-[orientation=vertical]:w-full data-[orientation=vertical]:justify-start data-active:text-foreground data-disabled:opacity-64 sm:h-8 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:-mx-0.5 [&_svg]:shrink-0",
});

const tabsPanelClass = cva({
	base: "flex-1 outline-none",
});

export function Tabs({
	className,
	...props
}: TabsPrimitive.Root.Props): ReactElement {
	return (
		<TabsPrimitive.Root
			{...props}
			className={tabsClass({ className })}
			data-slot="tabs"
		/>
	);
}

export function TabsList({
	children,
	className,
	...props
}: TabsPrimitive.List.Props): ReactElement {
	return (
		<TabsPrimitive.List
			{...props}
			className={tabsListClass({ className })}
			data-slot="tabs-list"
		>
			{children}
			<TabsPrimitive.Indicator
				className="absolute bottom-0 left-0 -z-1 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) -translate-y-(--active-tab-bottom) rounded-lg border border-border bg-background shadow-xs/5 transition-[width,translate] duration-200 ease-in-out"
				data-slot="tab-indicator"
			/>
		</TabsPrimitive.List>
	);
}

export function TabsTab({
	className,
	...props
}: TabsPrimitive.Tab.Props): ReactElement {
	return (
		<TabsPrimitive.Tab
			{...props}
			className={tabsTabClass({ className })}
			data-slot="tabs-tab"
		/>
	);
}

export function TabsPanel({
	className,
	...props
}: TabsPrimitive.Panel.Props): ReactElement {
	return (
		<TabsPrimitive.Panel
			{...props}
			className={tabsPanelClass({ className })}
			data-slot="tabs-content"
		/>
	);
}
