import { isRecord } from "@plot/common/primitives";
import type { AuthStatusInfo, ModelInfo } from "@plot/session/auth";
import type { RuntimeEvent } from "@plot/session/runtime";

const formatTokenCount = (count: number): string => {
	const scaled =
		count >= 1_000_000
			? count / 1_000_000
			: count >= 1_000
				? count / 1_000
				: count;
	const unit = count >= 1_000_000 ? "M" : count >= 1_000 ? "K" : "";
	const text = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
	return `${text}${unit}`;
};

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

export const renderRunEvent = (record: RuntimeEvent): string | undefined => {
	if (record.kind === "agent_event") {
		const event = record.event;
		if (!isRecord(event)) return undefined;
		if (event["type"] === "agent_start") return "Inner agent started.\n";
		if (event["type"] === "agent_end") {
			const text = finalAssistantTextFromAgentEnd(event);
			return text === undefined
				? "Inner agent finished.\n"
				: `\nFinal assistant message:\n${text}\n\nInner agent finished.\n`;
		}
		return undefined;
	}
	const event = record.event;
	if (event.type === "session_started")
		return `Started session ${record.sessionId}.\n`;
	if (event.type === "session_shutdown")
		return `Shutdown session ${record.sessionId}.\n`;
	if (event.type === "attempt_started")
		return `Started work ${event.run.workKey}.\n`;
	if (event.type === "attempt_completed")
		return `Completed work ${event.completion.workKey}: ${event.completion.status}.\n`;
	return undefined;
};
