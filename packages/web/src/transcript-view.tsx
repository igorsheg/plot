import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { Text } from "@astryxdesign/core/Text";
import clsx from "clsx";
import { useState } from "react";
import { fetchTranscript, type TranscriptEntry } from "./api.js";

const roleLabel: Record<TranscriptEntry["role"], string> = {
	user: "operator prompt",
	assistant: "agent",
	tool: "tool result",
};

function Prose({
	dimmed,
	text,
}: {
	readonly dimmed?: boolean | undefined;
	readonly text: string;
}) {
	return (
		<div className={clsx(dimmed === true && "plot-dim plot-italic")}>
			<Markdown density="compact" headingLevelStart={4} contentWidth="100%">
				{text}
			</Markdown>
		</div>
	);
}

function Entry({ entry }: { readonly entry: TranscriptEntry }) {
	if (entry.kind === "tool-call") {
		return (
			<div className="plot-entry">
				<Collapsible
					defaultIsOpen={false}
					trigger={
						<Text type="code" color="secondary">
							❯ {entry.name ?? "tool"}
						</Text>
					}
				>
					<CodeBlock
						code={entry.text}
						language="plaintext"
						size="sm"
						isWrapped
						width="100%"
						hasCopyButton={false}
					/>
				</Collapsible>
			</div>
		);
	}
	if (entry.kind === "tool-result") {
		return (
			<div className="plot-entry">
				<Collapsible
					defaultIsOpen={false}
					trigger={
						<Text type="code" color="secondary">
							⌗ {roleLabel[entry.role]} · {entry.text.length} chars
						</Text>
					}
				>
					<CodeBlock
						code={entry.text}
						language="plaintext"
						size="sm"
						isWrapped
						width="100%"
						hasCopyButton={false}
						maxHeight={192}
					/>
				</Collapsible>
			</div>
		);
	}
	return (
		<div className="plot-stack-tight">
			<Text type="label" color="secondary" className="plot-lane-title">
				{entry.kind === "thinking" ? "thinking" : roleLabel[entry.role]}
			</Text>
			<Prose text={entry.text} dimmed={entry.kind === "thinking"} />
		</div>
	);
}

export function TranscriptView({
	attemptRunId,
	path,
	runId,
}: {
	readonly attemptRunId: string;
	readonly path: string;
	readonly runId: string;
}) {
	const [state, setState] = useState<{
		readonly loading: boolean;
		readonly error?: string | undefined;
		readonly entries?: readonly TranscriptEntry[] | undefined;
	}>({ loading: false });

	const load = async () => {
		setState({ loading: true });
		try {
			setState({
				loading: false,
				entries: await fetchTranscript(runId, attemptRunId),
			});
		} catch (caught) {
			setState({
				loading: false,
				error: caught instanceof Error ? caught.message : String(caught),
			});
		}
	};

	if (state.entries !== undefined) {
		return state.entries.length === 0 ? (
			<Text type="supporting">The transcript file is empty.</Text>
		) : (
			<div className="plot-stack">
				{state.entries.map((entry, index) => (
					<Entry key={`${entry.at ?? ""}:${index}`} entry={entry} />
				))}
			</div>
		);
	}
	return (
		<div className="plot-stack-tight">
			<div className="plot-row">
				<Text type="code" color="secondary" maxLines={1} className="plot-fill">
					{path}
				</Text>
				<Button
					label="View"
					isLoading={state.loading}
					size="sm"
					variant="secondary"
					clickAction={load}
				/>
			</div>
			{state.loading && <Skeleton height={64} width="100%" />}
			{state.error !== undefined && (
				<Text type="supporting" className="plot-error-text">
					{state.error}
				</Text>
			)}
		</div>
	);
}
