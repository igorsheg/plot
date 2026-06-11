import type { PlotSessionEvent } from "@plot/session/plot-session";
import type { PlotAuthStatusInfo, PlotModelInfo } from "@plot/session/pi-auth";

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
	models: readonly PlotModelInfo[],
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

export const renderAuthStatus = (statuses: readonly PlotAuthStatusInfo[]) =>
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

const finalAssistantTextFromAgentEnd = (event: unknown): string | undefined => {
	if (!isRecord(event) || !Array.isArray(event["messages"])) return undefined;
	const assistant = event["messages"].findLast(
		(m) => isRecord(m) && m["role"] === "assistant",
	);
	if (!isRecord(assistant)) return undefined;
	const text = textFromContent(assistant["content"]).trim();
	return text.length ? text : undefined;
};

export const renderRunEvent = (event: PlotSessionEvent): string | undefined => {
	if (event.type === "session_started")
		return `Started session ${event.sessionId}.\n`;
	if (event.type === "session_shutdown")
		return `Shutdown session ${event.sessionId}.\n`;
	if (event.type === "agent_session_event") {
		if (event.eventType === "agent_start") return "Inner agent started.\n";
		if (event.eventType === "agent_end") {
			const text = finalAssistantTextFromAgentEnd(event.event);
			return text === undefined
				? "Inner agent finished.\n"
				: `\nFinal assistant message:\n${text}\n\nInner agent finished.\n`;
		}
	}
	if (event.type === "plot_agent_event") {
		if (event.event.type === "work_started")
			return `Started work ${event.event.run.workKey}.\n`;
		if (event.event.type === "work_completed")
			return `Completed work ${event.event.completion.workKey}: ${event.event.completion.status}.\n`;
	}
	return undefined;
};
