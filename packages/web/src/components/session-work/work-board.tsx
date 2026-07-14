/**
 * The board layout: salience columns rendered as coss `Frame` surfaces, each
 * holding a stack of `WorkCard` cards. It speaks the same work-state vocabulary
 * as the river (see work-item.tsx) — attention, motion, queued, settled — laid
 * out as kanban columns instead of a vertical list.
 */

import type { ReactNode } from "react";
import { Badge } from "../ui/badge.js";
import { Frame } from "../ui/frame.js";
import { Text } from "../ui/text.js";
import { cva } from "../ui/variants.js";

const rootClass = cva({
	base: "flex w-max min-w-full items-start gap-3 pb-2",
});

const columnClass = cva({
	base: "w-80 shrink-0 p-2",
});

const columnHeaderClass = cva({
	base: "flex items-center gap-2 px-2 py-2",
});

const columnTitleClass = cva({
	base: "min-w-0 flex-1",
});

const columnListClass = cva({
	base: "m-0 flex list-none flex-col gap-2 p-0",
});

export function Root({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<div className={rootClass()} data-slot="work-board-root">
			{children}
		</div>
	);
}

// `Frame` sets its own `data-slot="frame"` after spreading props, so a passed
// `data-slot` cannot win; the column keeps Frame's stable slot rather than
// hacking around the spread order.
export function Column({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return <Frame className={columnClass()}>{children}</Frame>;
}

export function ColumnHeader({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<div className={columnHeaderClass()} data-slot="work-board-column-header">
			{children}
		</div>
	);
}

export function ColumnTitle({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<span className={columnTitleClass()} data-slot="work-board-column-title">
			<Text as="span" bold size="sm" truncate>
				{children}
			</Text>
		</span>
	);
}

export function ColumnCount({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return <Badge data-slot="work-board-column-count">{children}</Badge>;
}

export function ColumnList({
	children,
}: {
	readonly children: ReactNode;
}): ReactNode {
	return (
		<ul className={columnListClass()} data-slot="work-board-column-list">
			{children}
		</ul>
	);
}

export const WorkBoard = {
	Column,
	ColumnCount,
	ColumnHeader,
	ColumnList,
	ColumnTitle,
	Root,
} as const;
