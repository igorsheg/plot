/**
 * Port of the coss-ui Frame primitive — surfaces only. `Frame` is the muted
 * rounded column container; `FramePanel` is the raised card that sits on it.
 * Typography is deliberately not ported (it lives in `Text`); this file is
 * brought over per the "port external UI primitives only when rendered" rule.
 */

import type { HTMLAttributes, ReactElement } from "react";
import { cva } from "./variants.js";

const frameClass = cva({
	base: "relative flex flex-col rounded-2xl bg-muted/72 p-1 *:[[data-slot=frame-panel]+[data-slot=frame-panel]]:mt-1",
});

export const framePanelClass = cva({
	base: "relative rounded-xl border bg-card bg-clip-padding shadow-xs/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-xl)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
	variants: {
		padding: {
			panel: "p-5",
			none: null,
		},
	},
	defaultVariants: {
		padding: "panel",
	},
});

const frameHeaderClass = cva({
	base: "flex flex-col px-5 py-4",
});

const frameFooterClass = cva({
	base: "px-5 py-4",
});

export function Frame({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>): ReactElement {
	return (
		<div {...props} className={frameClass({ className })} data-slot="frame" />
	);
}

export function FramePanel({
	className,
	...props
}: HTMLAttributes<HTMLDivElement>): ReactElement {
	return (
		<div
			{...props}
			className={framePanelClass({ padding: "panel", className })}
			data-slot="frame-panel"
		/>
	);
}

export function FrameHeader({
	className,
	...props
}: HTMLAttributes<HTMLElement>): ReactElement {
	return (
		<header
			{...props}
			className={frameHeaderClass({ className })}
			data-slot="frame-panel-header"
		/>
	);
}

export function FrameFooter({
	className,
	...props
}: HTMLAttributes<HTMLElement>): ReactElement {
	return (
		<footer
			{...props}
			className={frameFooterClass({ className })}
			data-slot="frame-panel-footer"
		/>
	);
}
