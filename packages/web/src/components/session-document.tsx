import { useStore } from "@nanostores/react";
import type { CSSProperties, ReactNode } from "react";
import {
	$selectedRun,
	$sessionBrief,
	$sessionHeader,
	$stopSelectedRun,
	refreshSessions,
	stopSelectedRun,
	type BriefRecentItem,
	type BriefWorkItem,
	type StatusTone,
} from "../app/store.js";
import { Button } from "./ui/button.js";
import Stack, { VStack } from "./ui/stack.js";
import { Text } from "./ui/text.js";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";

const mainStyle: CSSProperties = {
	flex: "1 1 0%",
	minWidth: 0,
	padding: "var(--plot-page-top) var(--plot-space-8) var(--plot-page-bottom) 0",
};

const documentStyle: CSSProperties = {
	margin: "0 auto",
	maxWidth: "calc(var(--plot-rhythm) * 208)",
	width: "100%",
};

const emptyDocumentStyle: CSSProperties = {
	...documentStyle,
	minHeight: "calc(var(--plot-rhythm) * 128)",
};

const actionsStyle: CSSProperties = { flex: "none" };
const briefStyle: CSSProperties = { paddingTop: "var(--plot-space-1)" };
const briefSectionStyle: CSSProperties = {
	maxWidth: "calc(var(--plot-rhythm) * 168)",
};
const listStyle: CSSProperties = { listStyle: "none", margin: 0, padding: 0 };
const itemStyle: CSSProperties = { minWidth: 0 };
const lineStyle: CSSProperties = { minWidth: 0 };
const dotBaseStyle: CSSProperties = {
	borderRadius: 999,
	flex: "0 0 auto",
	height: "var(--plot-space-2)",
	marginTop: "var(--plot-space-1)",
	width: "var(--plot-space-2)",
};

const toneColor: Record<StatusTone, string> = {
	error: "var(--color-kumo-danger)",
	info: "var(--color-kumo-info)",
	secondary: "var(--color-kumo-badge-neutral)",
	success: "var(--color-kumo-success)",
	warning: "var(--color-kumo-warning)",
};

function StatusDot({ tone }: { readonly tone: StatusTone }) {
	return (
		<span
			aria-hidden="true"
			style={{ ...dotBaseStyle, background: toneColor[tone] }}
		/>
	);
}

function EmptySelection() {
	return (
		<VStack as="main" style={mainStyle}>
			<VStack as="article" style={emptyDocumentStyle} gap={12} center>
				<Text variant="heading1" as="h1">
					No active sessions.
				</Text>
				<Text variant="secondary">
					The dock only shows live sessions. Start one and it will appear here.
				</Text>
			</VStack>
		</VStack>
	);
}

function DocumentHeader() {
	const header = useStore($sessionHeader);
	const stopState = useStore($stopSelectedRun);
	if (header === undefined) return null;
	return (
		<VStack as="header" gap={12}>
			<Text variant="secondary" size="sm" as="p">
				{header.kicker}
			</Text>
			<Stack between alignCenter gap={16} wrap>
				<Text variant="heading1" as="h1">
					{header.title}
				</Text>
				<Stack style={actionsStyle} gap={12} alignCenter>
					<Button
						aria-label="Refresh sessions"
						icon={ArrowsClockwiseIcon}
						size="sm"
						variant="ghost"
						onClick={refreshSessions}
					/>
					{header.live && (
						<Button
							disabled={stopState.loading}
							variant="outline"
							size="sm"
							onClick={() => void stopSelectedRun()}
						>
							Stop
						</Button>
					)}
				</Stack>
			</Stack>
			<Text variant="secondary" as="p">
				{header.workCount} active · {header.settledCount} recent completions
			</Text>
		</VStack>
	);
}

function BriefSection({
	children,
	title,
}: {
	readonly children: ReactNode;
	readonly title: string;
}) {
	return (
		<VStack as="section" style={briefSectionStyle} gap={16}>
			<Text variant="secondary" size="xs" as="h2" bold>
				{title}
			</Text>
			{children}
		</VStack>
	);
}

function EmptyLine({ children }: { readonly children: ReactNode }) {
	return (
		<Text as="p" variant="secondary">
			{children}
		</Text>
	);
}

function WorkLine({ item }: { readonly item: BriefWorkItem }) {
	return (
		<Stack as="li" style={itemStyle} gap={12} alignStart>
			<StatusDot tone={item.tone} />
			<VStack gap={4} flex1>
				<Stack style={lineStyle} gap={8} baseline wrap>
					<Text as="span" bold>
						{item.label}
					</Text>
					<Text as="span" variant="mono-secondary">
						{item.status}
					</Text>
				</Stack>
				<Text as="p" variant="secondary">
					{item.activity}
				</Text>
			</VStack>
		</Stack>
	);
}

function RecentLine({ item }: { readonly item: BriefRecentItem }) {
	return (
		<Stack as="li" style={itemStyle} gap={12} alignStart>
			<StatusDot tone={item.tone} />
			<VStack gap={4} flex1>
				<Stack style={lineStyle} gap={8} baseline wrap>
					<Text as="span" bold>
						{item.label}
					</Text>
					<Text as="span" variant="mono-secondary">
						{item.status}
					</Text>
				</Stack>
				<Text as="p" variant="secondary">
					{item.message}
				</Text>
			</VStack>
		</Stack>
	);
}

function DiagnosticLine({ children }: { readonly children: ReactNode }) {
	return (
		<Stack as="li" style={itemStyle} gap={12} alignStart>
			<StatusDot tone="error" />
			<Text as="p" variant="error">
				{children}
			</Text>
		</Stack>
	);
}

function OperatorBrief() {
	const brief = useStore($sessionBrief);
	if (brief === undefined) {
		return (
			<BriefSection title="Now">
				<EmptyLine>Loading projection…</EmptyLine>
			</BriefSection>
		);
	}
	const needsNothing =
		brief.attention.length === 0 && brief.diagnostics.length === 0;
	return (
		<VStack style={briefStyle} gap={48}>
			<BriefSection title="Now">
				{brief.now.length === 0 ? (
					<EmptyLine>No active work.</EmptyLine>
				) : (
					<VStack as="ul" style={listStyle} gap={20}>
						{brief.now.map((item) => (
							<WorkLine key={item.key} item={item} />
						))}
					</VStack>
				)}
			</BriefSection>

			<BriefSection title="Needs you">
				{needsNothing ? (
					<EmptyLine>No decisions needed.</EmptyLine>
				) : (
					<VStack as="ul" style={listStyle} gap={20}>
						{brief.diagnostics.map((item) => (
							<DiagnosticLine key={item}>{item}</DiagnosticLine>
						))}
						{brief.attention.map((item) => (
							<WorkLine key={item.key} item={item} />
						))}
					</VStack>
				)}
			</BriefSection>

			<BriefSection title="Recent">
				{brief.recent.length === 0 ? (
					<EmptyLine>No completed work yet.</EmptyLine>
				) : (
					<VStack as="ul" style={listStyle} gap={20}>
						{brief.recent.map((item) => (
							<RecentLine key={item.key} item={item} />
						))}
					</VStack>
				)}
			</BriefSection>
		</VStack>
	);
}

function SessionDocument() {
	return (
		<VStack as="main" style={mainStyle}>
			<VStack as="article" style={documentStyle} gap={48}>
				<DocumentHeader />
				<OperatorBrief />
			</VStack>
		</VStack>
	);
}

export function SessionMain() {
	const selectedRun = useStore($selectedRun);
	return selectedRun === undefined ? <EmptySelection /> : <SessionDocument />;
}
