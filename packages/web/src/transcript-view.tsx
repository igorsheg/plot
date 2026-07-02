import { useState } from "react";
import Markdown from "react-markdown";
import { fetchTranscript, type TranscriptEntry } from "./api.js";
import { Button } from "./components/ui/button.js";
import { Skeleton } from "./components/ui/skeleton.js";
import { cn } from "./lib/utils.js";

const roleLabel: Record<TranscriptEntry["role"], string> = {
	user: "operator prompt",
	assistant: "agent",
	tool: "tool result",
};

/** react-markdown is safe by default (no raw HTML); transcripts carry
 *  third-party text such as PR bodies, so that property is load-bearing. */
function Prose({
	dimmed,
	text,
}: {
	readonly dimmed?: boolean | undefined;
	readonly text: string;
}) {
	return (
		<div
			className={cn(
				"transcript-prose text-xs",
				dimmed === true && "text-muted-foreground/80 italic",
			)}
		>
			<Markdown>{text}</Markdown>
		</div>
	);
}

function Entry({ entry }: { readonly entry: TranscriptEntry }) {
	if (entry.kind === "tool-call") {
		return (
			<details className="rounded border bg-muted/30 px-2 py-1">
				<summary className="cursor-pointer list-none font-mono text-[10px] text-muted-foreground">
					❯ {entry.name ?? "tool"}
				</summary>
				<pre className="mt-1 overflow-x-auto font-mono text-[10px] whitespace-pre-wrap text-muted-foreground">
					{entry.text}
				</pre>
			</details>
		);
	}
	if (entry.kind === "tool-result") {
		return (
			<details className="rounded border bg-muted/30 px-2 py-1">
				<summary className="cursor-pointer list-none font-mono text-[10px] text-muted-foreground">
					⌗ {roleLabel[entry.role]} · {entry.text.length} chars
				</summary>
				<pre className="mt-1 max-h-48 overflow-y-auto font-mono text-[10px] whitespace-pre-wrap text-muted-foreground">
					{entry.text}
				</pre>
			</details>
		);
	}
	return (
		<div className="space-y-0.5">
			<div className="text-[10px] tracking-wide text-muted-foreground uppercase">
				{entry.kind === "thinking" ? "thinking" : roleLabel[entry.role]}
			</div>
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
			<p className="text-xs text-muted-foreground">
				The transcript file is empty.
			</p>
		) : (
			<div className="space-y-2">
				{state.entries.map((entry, index) => (
					<Entry key={`${entry.at ?? ""}:${index}`} entry={entry} />
				))}
			</div>
		);
	}
	return (
		<div className="space-y-1.5">
			<div className="flex items-center gap-2">
				<span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
					{path}
				</span>
				<Button
					size="sm"
					variant="outline"
					disabled={state.loading}
					onClick={() => void load()}
				>
					{state.loading ? "…" : "View"}
				</Button>
			</div>
			{state.loading && <Skeleton className="h-16 w-full rounded" />}
			{state.error !== undefined && (
				<p className="text-xs text-destructive-foreground">{state.error}</p>
			)}
		</div>
	);
}
