import type { AuthStatusInfo, ModelInfo } from "@plot/session/auth";
import type { EventLogRecord } from "@plot/session/event-log";

const formatTokenCount = (count: number): string =>
	count >= 1_000_000
		? `${count / 1_000_000}${count % 1_000_000 === 0 ? "" : ""}M`
		: count >= 1_000
			? `${count / 1_000}${count % 1_000 === 0 ? "" : ""}K`
			: count.toString();

const renderTable = (
	rows: readonly Record<string, string>[],
	headers: readonly string[],
) => {
	const widths = Object.fromEntries(
		headers.map((h) => [
			h,
			Math.max(h.length, ...rows.map((r) => r[h]?.length ?? 0)),
		]),
	);
	return [
		headers.map((h) => h.padEnd(widths[h] ?? 0)).join("  "),
		...rows.map((r) =>
			headers.map((h) => (r[h] ?? "").padEnd(widths[h] ?? 0)).join("  "),
		),
	].join("\n");
};

export const renderModels = (
	search: string | undefined,
	models: readonly ModelInfo[],
) =>
	models.length === 0
		? search === undefined
			? "No models available. Configure provider auth and try again.\n"
			: `No models matching "${search}"\n`
		: `${renderTable(
				models.map((m) => ({
					provider: m.provider,
					model: m.model,
					context: formatTokenCount(m.context),
					"max-out": formatTokenCount(m.maxOutput),
					thinking: m.thinking ? "yes" : "no",
					images: m.images ? "yes" : "no",
				})),
				["provider", "model", "context", "max-out", "thinking", "images"],
			)}\n`;

export const renderAuthStatus = (statuses: readonly AuthStatusInfo[]) =>
	statuses.length === 0
		? "No auth providers found.\n"
		: `${renderTable(
				statuses.map((s) => ({
					provider: s.provider,
					configured: s.configured ? "yes" : "no",
					source: s.source ?? "",
					label: s.label ?? "",
				})),
				["provider", "configured", "source", "label"],
			)}\n`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const textFromContent = (content: unknown): string =>
	typeof content === "string"
		? content
		: Array.isArray(content)
			? content
					.flatMap((b) =>
						isRecord(b) && b["type"] === "text" && typeof b["text"] === "string"
							? [b["text"]]
							: [],
					)
					.join("\n")
			: "";

const collectTextBlocks = (value: unknown): readonly string[] => {
	if (isRecord(value)) {
		if (value["type"] === "text" && typeof value["text"] === "string")
			return [value["text"]];
		return Object.values(value).flatMap(collectTextBlocks);
	}
	return Array.isArray(value) ? value.flatMap(collectTextBlocks) : [];
};

const finalAssistantTextFromAgentEnd = (event: unknown): string | undefined => {
	if (!isRecord(event)) return undefined;
	if (!Array.isArray(event["messages"])) {
		const fallback = collectTextBlocks(event).join("\n").trim();
		return fallback.length ? fallback : undefined;
	}
	const assistant = event["messages"].findLast(
		(m) => isRecord(m) && m["role"] === "assistant",
	);
	if (!isRecord(assistant)) return undefined;
	const text = textFromContent(assistant["content"]).trim();
	if (text.length) return text;
	const fallback = collectTextBlocks(assistant).join("\n").trim();
	return fallback.length ? fallback : undefined;
};

export const renderRunEvent = (event: EventLogRecord): string | undefined => {
	if (event.kind !== "session_event") return undefined;
	if (event.type === "session_started")
		return `Started session ${event.sessionId}.\n`;
	if (event.type === "session_shutdown")
		return `Shutdown session ${event.sessionId}.\n`;
	if (!isRecord(event.payload)) return undefined;
	if (event.type === "agent_run_event") {
		if (event.payload["eventType"] === "agent_start")
			return "Inner agent started.\n";
		if (event.payload["eventType"] === "agent_end") {
			const text = finalAssistantTextFromAgentEnd(event.payload["event"]);
			return text === undefined
				? "Inner agent finished.\n"
				: `\nFinal assistant message:\n${text}\n\nInner agent finished.\n`;
		}
	}
	if (event.type === "attempt_started" && isRecord(event.payload["run"]))
		return `Started work ${String(event.payload["run"]["workKey"] ?? "work")}.\n`;
	if (
		event.type === "attempt_completed" &&
		isRecord(event.payload["completion"])
	)
		return `Completed work ${String(
			event.payload["completion"]["workKey"] ?? "work",
		)}: ${String(event.payload["completion"]["status"] ?? "unknown")}.\n`;
	return undefined;
};
