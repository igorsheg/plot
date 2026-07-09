import type { Meta, StoryObj } from "@storybook/react-vite";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/utils.js";
import type { WorkState } from "../ui/icons.js";
import { XIcon } from "../ui/icons.js";
import { Button } from "../ui/button.js";
import Stack, { VStack } from "../ui/stack.js";
import { Text } from "../ui/text.js";
import { ThroughputSparkline } from "../session-header/throughput-sparkline.js";
import { StateIcon } from "./atoms.js";

/**
 * Scratch: the work detail as an inline split — clicking a row pushes the river
 * left and opens a full-height, bordered detail pane as a flex sibling (not a
 * floating sheet). Vaul-style easing; content fades/slides; items cross-fade.
 */
const meta = {
	title: "Work/Detail Split",
	parameters: { layout: "fullscreen" },
} satisfies Meta;

export default meta;

interface TimelineRow {
	readonly kind: string;
	readonly text: string;
	readonly at: string;
}

interface Item {
	readonly key: string;
	readonly state: WorkState;
	readonly title: string;
	readonly edge: string;
	readonly word: string;
	readonly body: string;
	readonly timeline: readonly TimelineRow[];
}

const ITEMS: readonly Item[] = [
	{
		key: "decision",
		state: "attention",
		title: "Approve deploy to staging?",
		edge: "2m",
		word: "decision · awaiting you",
		body: "Verification passed on all three checks. Approve to promote the build to staging, or reject to hold and let the workflow retry.",
		timeline: [
			{ kind: "build", text: "compiled 42 modules", at: "3m" },
			{ kind: "verify", text: "all checks green", at: "2m" },
			{ kind: "block", text: "waiting for operator", at: "2m" },
		],
	},
	{
		key: "active",
		state: "active",
		title: "Refactor the host message pump",
		edge: "20s",
		word: "active · running",
		body: "Editing packages/session/src/host.ts — extracting the dispatch loop into a standalone reducer so the transport can be swapped without touching the state machine.",
		timeline: [
			{ kind: "read", text: "host.ts, protocol.ts", at: "1m" },
			{ kind: "edit", text: "extract dispatch()", at: "40s" },
			{ kind: "edit", text: "wire reducer", at: "20s" },
		],
	},
	{
		key: "failure",
		state: "attention",
		title: "verify step failed",
		edge: "1m",
		word: "failure · needs attention",
		body: "AssertionError: expected 200, received 500 — host.test.ts:42. The gateway returned an error before the session was ready.",
		timeline: [
			{ kind: "run", text: "bun test test/host.test.ts", at: "1m" },
			{ kind: "fail", text: "1 assertion failed", at: "1m" },
		],
	},
	{
		key: "settled",
		state: "history",
		title: "committed refine host message pump",
		edge: "8m",
		word: "run succeeded · c634736",
		body: "Committed the message-pump refactor. 6 files changed, tests green.",
		timeline: [{ kind: "commit", text: "c634736", at: "8m" }],
	},
];

const EASE = [0.32, 0.72, 0, 1] as const;
const PANEL = 420;

function Row({
	item,
	selected,
	onClick,
}: {
	readonly item: Item;
	readonly selected: boolean;
	readonly onClick: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"flex w-full items-baseline gap-3 rounded-lg p-2 text-left transition-colors",
				selected ? "bg-accent" : "hover:bg-accent/60",
			)}
		>
			<span className="inline-flex shrink-0 translate-y-px self-center">
				<StateIcon state={item.state} />
			</span>
			<span className="min-w-0 flex-1">
				<Text as="p" truncate>
					{item.title}
				</Text>
			</span>
			<span className="shrink-0 whitespace-nowrap">
				<Text as="span" size="sm" variant="secondary">
					{item.edge}
				</Text>
			</span>
		</button>
	);
}

function Detail({
	item,
	onClose,
}: {
	readonly item: Item;
	readonly onClose: () => void;
}) {
	return (
		<VStack style={{ height: "100%" }}>
			<Stack alignStart between gap={12} style={{ padding: "20px 24px 12px" }}>
				<Stack alignCenter gap={8}>
					<StateIcon state={item.state} />
					<Text as="span" variant="secondary" size="sm">
						{item.word}
					</Text>
				</Stack>
				<Button
					aria-label="Close"
					onClick={onClose}
					size="icon"
					variant="ghost"
				>
					<XIcon aria-hidden />
				</Button>
			</Stack>
			<VStack
				gap={24}
				style={{
					flex: 1,
					minHeight: 0,
					overflowY: "auto",
					padding: "4px 24px 24px",
				}}
			>
				<Text as="h2" variant="heading3">
					{item.title}
				</Text>
				<Text variant="secondary">{item.body}</Text>
				<VStack gap={8}>
					<Text variant="label">Timeline</Text>
					<VStack gap={8}>
						{item.timeline.map((row, index) => (
							<Stack alignStart gap={12} key={`${row.at}:${index}`}>
								<span style={{ width: 56, flexShrink: 0 }}>
									<Text as="span" variant="mono-secondary" size="sm">
										{row.kind}
									</Text>
								</span>
								<span style={{ flex: 1, minWidth: 0 }}>
									<Text as="span" size="sm">
										{row.text}
									</Text>
								</span>
								<Text as="span" variant="mono-secondary" size="sm">
									{row.at}
								</Text>
							</Stack>
						))}
					</VStack>
				</VStack>
			</VStack>
		</VStack>
	);
}

/** A stand-in session header, so the detail pushes header + river together. */
function MockHeader() {
	return (
		<VStack as="header" gap={24}>
			<Stack alignCenter between gap={16}>
				<Text as="h1" variant="heading1">
					pr-review
				</Text>
				<Button size="sm" variant="outline">
					Stop
				</Button>
			</Stack>
			<Stack baseline between gap={16}>
				<Text as="span" variant="secondary" size="sm">
					epic · started 12m ago
				</Text>
				<Stack baseline gap={12}>
					<Text as="span" variant="mono-secondary" size="sm">
						48.3k · $0.42 · 1.2k tok/s
					</Text>
					<ThroughputSparkline graph="▇█▆█▇█▆▇" />
				</Stack>
			</Stack>
		</VStack>
	);
}

function DetailSplit({
	initialKey = null,
}: {
	readonly initialKey?: string | null;
}) {
	const [selectedKey, setSelectedKey] = useState<string | null>(initialKey);
	const selected = ITEMS.find((item) => item.key === selectedKey) ?? null;
	const open = selected !== null;

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") setSelectedKey(null);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open]);

	return (
		<div style={{ height: 620, display: "flex", flexDirection: "column" }}>
			<div
				style={{
					flex: 1,
					minHeight: 0,
					display: "flex",
					overflow: "hidden",
					border: "1px solid var(--border)",
					borderRadius: 14,
					background: "var(--background)",
				}}
			>
				{/* the main body — header + river, pushed together as one column */}
				<div
					style={{
						flex: 1,
						minWidth: 0,
						overflowY: "auto",
						padding: "48px 24px",
					}}
				>
					<VStack gap={48} style={{ maxWidth: 720, margin: "0 auto" }}>
						<MockHeader />
						<VStack
							as="ul"
							gap={0}
							style={{ listStyle: "none", margin: 0, padding: 0 }}
						>
							{ITEMS.map((item) => (
								<li key={item.key} style={{ listStyle: "none" }}>
									<Row
										item={item}
										selected={item.key === selectedKey}
										onClick={() =>
											setSelectedKey((key) =>
												key === item.key ? null : item.key,
											)
										}
									/>
								</li>
							))}
						</VStack>
					</VStack>
				</div>

				{/* the detail — a flowed sibling, not a floating sheet */}
				<motion.aside
					initial={false}
					animate={{ width: open ? PANEL : 0 }}
					transition={{ duration: 0.5, ease: EASE }}
					style={{ overflow: "hidden", flexShrink: 0 }}
				>
					<div
						style={{
							width: PANEL,
							height: "100%",
							borderLeft: "1px solid var(--border)",
							boxSizing: "border-box",
						}}
					>
						<AnimatePresence mode="wait">
							{selected !== null && (
								<motion.div
									key={selected.key}
									initial={{ opacity: 0, x: 12 }}
									animate={{ opacity: 1, x: 0 }}
									exit={{ opacity: 0, x: 12 }}
									transition={{ duration: 0.26, ease: EASE }}
									style={{ height: "100%" }}
								>
									<Detail
										item={selected}
										onClose={() => setSelectedKey(null)}
									/>
								</motion.div>
							)}
						</AnimatePresence>
					</div>
				</motion.aside>
			</div>
		</div>
	);
}

/** Starts closed — click a row to feel the open/close push. */
export const Interactive: StoryObj = {
	render: () => <DetailSplit />,
};

/** Pre-opened, for reviewing the split layout at rest. */
export const Open: StoryObj = {
	render: () => <DetailSplit initialKey="decision" />,
};
