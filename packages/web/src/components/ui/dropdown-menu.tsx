"use client";

import { Menu } from "@base-ui/react/menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

const DropdownMenu = Menu.Root;
const DropdownMenuGroup = Menu.Group;
const DropdownMenuPortal = Menu.Portal;
const DropdownMenuSub = Menu.SubmenuRoot;
const DropdownMenuRadioGroup = Menu.RadioGroup;

const renderAsChild = (children: React.ReactNode) =>
	React.isValidElement(children)
		? { render: children as React.ReactElement<Record<string, unknown>> }
		: {};

const DropdownMenuTrigger = React.forwardRef<
	HTMLButtonElement,
	React.ComponentPropsWithoutRef<typeof Menu.Trigger> & { asChild?: boolean }
>(({ asChild = false, children, ...props }, ref) => (
	<Menu.Trigger
		ref={ref}
		{...(asChild ? renderAsChild(children) : {})}
		{...props}
	>
		{asChild && React.isValidElement(children) ? undefined : children}
	</Menu.Trigger>
));
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";

const DropdownMenuSubTrigger = React.forwardRef<
	React.ElementRef<typeof Menu.SubmenuTrigger>,
	React.ComponentPropsWithoutRef<typeof Menu.SubmenuTrigger> & {
		inset?: boolean;
	}
>(({ className, inset = false, children, ...props }, ref) => (
	<Menu.SubmenuTrigger
		ref={ref}
		className={cn(
			"focus:bg-accent data-popup-open:bg-accent flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none",
			inset && "pl-8",
			className,
		)}
		{...props}
	>
		{children}
		<ChevronRight className="ml-auto h-4 w-4" />
	</Menu.SubmenuTrigger>
));
DropdownMenuSubTrigger.displayName = "DropdownMenuSubTrigger";

const DropdownMenuSubContent = React.forwardRef<
	React.ElementRef<typeof Menu.Popup>,
	React.ComponentPropsWithoutRef<typeof Menu.Popup> & { sideOffset?: number }
>(({ className, sideOffset = 4, ...props }, ref) => (
	<Menu.Portal>
		<Menu.Positioner className="z-50 outline-none" sideOffset={sideOffset}>
			<Menu.Popup
				ref={ref}
				className={cn(
					"bg-popover text-popover-foreground data-ending-style:animate-out data-starting-style:animate-in data-ending-style:fade-out-0 data-starting-style:fade-in-0 data-ending-style:zoom-out-95 data-starting-style:zoom-in-95 z-50 min-w-[8rem] overflow-hidden rounded-md border border-[rgb(0_0_0_/_0.15)] bg-clip-padding p-1 shadow-lg dark:border-[rgb(255_255_255_/_0.15)] dark:shadow-black/25",
					className,
				)}
				{...props}
			/>
		</Menu.Positioner>
	</Menu.Portal>
));
DropdownMenuSubContent.displayName = "DropdownMenuSubContent";

const DEFAULT_SELECTED_ITEM_SELECTOR =
	'[data-selected="true"], [aria-current="true"], [aria-checked="true"], [data-state="checked"], [data-checked]';

const DropdownMenuContent = React.forwardRef<
	React.ElementRef<typeof Menu.Popup>,
	React.ComponentPropsWithoutRef<typeof Menu.Popup> & {
		align?: "start" | "center" | "end";
		sideOffset?: number;
		scrollSelectedIntoView?: boolean;
		selectedItemSelector?: string;
		container?: HTMLElement | ShadowRoot | null;
	}
>(
	(
		{
			align: _align,
			className,
			sideOffset = 4,
			scrollSelectedIntoView = false,
			selectedItemSelector = DEFAULT_SELECTED_ITEM_SELECTOR,
			container,
			...props
		},
		ref,
	) => {
		const localRef = React.useRef<React.ElementRef<typeof Menu.Popup> | null>(
			null,
		);
		const scrollFrameRef = React.useRef<number | null>(null);

		const setRefs = React.useCallback(
			(node: React.ElementRef<typeof Menu.Popup> | null) => {
				const scrollIntoView =
					node != null && scrollSelectedIntoView && localRef.current !== node;

				if (node != null) localRef.current = node;

				if (scrollIntoView) {
					if (scrollFrameRef.current != null) {
						cancelAnimationFrame(scrollFrameRef.current);
					}

					scrollFrameRef.current = requestAnimationFrame(() => {
						scrollFrameRef.current = null;

						if (localRef.current !== node || !node.isConnected) return;

						node
							.querySelector<HTMLElement>(selectedItemSelector)
							?.scrollIntoView({ block: "nearest" });
					});
				}

				if (typeof ref === "function") ref(node);
				else if (ref != null) ref.current = node;
			},
			[ref, scrollSelectedIntoView, selectedItemSelector],
		);

		React.useEffect(
			() => () => {
				localRef.current = null;
				if (scrollFrameRef.current != null) {
					cancelAnimationFrame(scrollFrameRef.current);
				}
			},
			[],
		);

		return (
			<Menu.Portal container={container ?? undefined}>
				<Menu.Positioner className="z-50 outline-none" sideOffset={sideOffset}>
					<Menu.Popup
						ref={setRefs}
						className={cn(
							"bg-popover text-popover-foreground data-ending-style:animate-out data-starting-style:animate-in data-ending-style:fade-out-0 data-starting-style:fade-in-0 data-ending-style:zoom-out-95 data-starting-style:zoom-in-95 z-50 min-w-[8rem] space-y-[1px] overflow-hidden rounded-lg border border-[rgb(0_0_0_/_0.1)] bg-clip-padding p-1 shadow-lg dark:border-[rgb(255_255_255_/_0.15)] dark:shadow-black/25",
							className,
						)}
						{...props}
					/>
				</Menu.Positioner>
			</Menu.Portal>
		);
	},
);
DropdownMenuContent.displayName = "DropdownMenuContent";

const DropdownMenuItem = React.forwardRef<
	React.ElementRef<typeof Menu.Item>,
	React.ComponentPropsWithoutRef<typeof Menu.Item> & {
		inset?: boolean;
		selected?: boolean;
		variant?: "default" | "danger";
	}
>(
	(
		{
			className,
			inset = false,
			selected = false,
			variant = "default",
			...props
		},
		ref,
	) => (
		<Menu.Item
			ref={ref}
			className={cn(
				"focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center rounded-md px-3 py-1.5 text-sm outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50",
				selected && "bg-accent text-accent-foreground",
				variant === "danger" &&
					"text-destructive focus:bg-destructive/15 focus:text-destructive dark:text-destructive dark:focus:bg-destructive/15 dark:focus:text-destructive",
				inset && "pl-8",
				className,
			)}
			data-selected={selected ? "true" : undefined}
			{...props}
		/>
	),
);
DropdownMenuItem.displayName = "DropdownMenuItem";

const DropdownMenuCheckboxItem = React.forwardRef<
	React.ElementRef<typeof Menu.CheckboxItem>,
	React.ComponentPropsWithoutRef<typeof Menu.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
	<Menu.CheckboxItem
		ref={ref}
		className={cn(
			"focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 text-sm transition-colors outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50",
			className,
		)}
		checked={checked}
		{...props}
	>
		<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
			<Menu.CheckboxItemIndicator>
				<Check className="h-4 w-4" />
			</Menu.CheckboxItemIndicator>
		</span>
		{children}
	</Menu.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

const DropdownMenuRadioItem = React.forwardRef<
	React.ElementRef<typeof Menu.RadioItem>,
	React.ComponentPropsWithoutRef<typeof Menu.RadioItem>
>(({ className, children, ...props }, ref) => (
	<Menu.RadioItem
		ref={ref}
		className={cn(
			"focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 text-sm transition-colors outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50",
			className,
		)}
		{...props}
	>
		<span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
			<Menu.RadioItemIndicator>
				<Circle className="h-2 w-2 fill-current" />
			</Menu.RadioItemIndicator>
		</span>
		{children}
	</Menu.RadioItem>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

const DropdownMenuLabel = React.forwardRef<
	React.ElementRef<typeof Menu.GroupLabel>,
	React.ComponentPropsWithoutRef<typeof Menu.GroupLabel> & {
		inset?: boolean;
	}
>(({ className, inset = false, ...props }, ref) => (
	<Menu.GroupLabel
		ref={ref}
		className={cn(
			"px-2 py-1.5 text-sm font-semibold",
			inset && "pl-8",
			className,
		)}
		{...props}
	/>
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

const DropdownMenuSeparator = React.forwardRef<
	React.ElementRef<typeof Menu.Separator>,
	React.ComponentPropsWithoutRef<typeof Menu.Separator>
>(({ className, ...props }, ref) => (
	<Menu.Separator
		ref={ref}
		className={cn("bg-muted -mx-1 my-1 h-px", className)}
		{...props}
	/>
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

const DropdownMenuShortcut = ({
	className,
	...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
	return (
		<span
			className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
			{...props}
		/>
	);
};
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

export {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuPortal,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuShortcut,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
};
