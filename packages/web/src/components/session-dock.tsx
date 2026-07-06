import { useStore } from "@nanostores/react";
import type { CSSProperties } from "react";
import {
	$activeRuns,
	$selectedRun,
	displayName,
	dockGlyph,
	refreshSessions,
	selectRun,
} from "../app/store.js";
import type { PlotRun } from "../data/run.js";
import { ThemeToggle } from "../theme/theme.js";
import Stack, { VStack } from "./ui/stack.js";
import { Text } from "./ui/text.js";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";

const shellStyle: CSSProperties = {
	padding: "var(--plot-space-4) 0 var(--plot-space-4) var(--plot-space-4)",
};

const dockStyle: CSSProperties = {
	padding: 0,
	position: "sticky",
	top: "var(--plot-space-4)",
	width: "calc(var(--plot-rhythm) * 10)",
};

const dockButtonStyle = (selected: boolean): CSSProperties => ({
	background: selected ? "var(--color-kumo-tint)" : "transparent",
	border: 0,
	borderRadius: "var(--plot-space-3)",
	color: "var(--text-color-kumo-default)",
	display: "grid",
	height: "calc(var(--plot-rhythm) * 10)",
	placeItems: "center",
	transform: selected ? "translateX(var(--plot-space-1))" : undefined,
	transition: "background 120ms ease, transform 120ms ease",
	width: "calc(var(--plot-rhythm) * 10)",
});

function DockRun({ run }: { readonly run: PlotRun }) {
	const selectedRun = useStore($selectedRun);
	const selected = run.id === selectedRun?.id;
	return (
		<button
			aria-current={selected ? "page" : undefined}
			aria-label={displayName(run)}
			data-selected={selected ? "true" : "false"}
			style={dockButtonStyle(selected)}
			title={displayName(run)}
			type="button"
			onClick={() => selectRun(run.id)}
		>
			<Text as="span" size="xs" bold>
				{dockGlyph(run)}
			</Text>
		</button>
	);
}

function EmptyDock() {
	return (
		<Text as="span" variant="secondary">
			—
		</Text>
	);
}

function DockSessions() {
	const runs = useStore($activeRuns);
	return (
		<VStack gap={8}>
			{runs.map((run) => (
				<DockRun key={run.id} run={run} />
			))}
			{runs.length === 0 && <EmptyDock />}
		</VStack>
	);
}

export function SessionDock() {
	return (
		<Stack as="aside" aria-label="Active sessions" style={shellStyle}>
			<VStack as="nav" style={dockStyle} gap={12} alignCenter>
				<Button
					aria-label="Refresh sessions"
					icon={ArrowsClockwiseIcon}
					size="sm"
					variant="ghost"
					onClick={refreshSessions}
				/>
				<DockSessions />
				<ThemeToggle />
			</VStack>
		</Stack>
	);
}
