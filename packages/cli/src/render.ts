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

export const pad = (value: string, width: number): string =>
	value.length >= width ? value : value + " ".repeat(width - value.length);

export const table = (rows: readonly (readonly string[])[]): string => {
	const widths = rows[0]?.map((_, column) =>
		Math.max(...rows.map((row) => (row[column] ?? "").length)),
	);
	return rows
		.map((row) =>
			row
				.map((cell, column) => pad(cell, widths?.[column] ?? cell.length))
				.join("  ")
				.trimEnd(),
		)
		.join("\n");
};

export const renderModels = (
	search: string | undefined,
	models: readonly ModelInfo[],
) =>
	models.length === 0
		? search === undefined
			? "No models available. Configure provider auth and try again.\n"
			: `No models matching "${search}"\n`
		: `${table([
				["provider", "model", "context", "max-out", "thinking", "images"],
				...models.map((m) => [
					m.provider,
					m.model,
					formatTokenCount(m.context),
					formatTokenCount(m.maxOutput),
					m.thinking ? "yes" : "no",
					m.images ? "yes" : "no",
				]),
			])}\n`;

export const renderAuthStatus = (statuses: readonly AuthStatusInfo[]) =>
	statuses.length === 0
		? "No auth providers found.\n"
		: `${table([
				["provider", "configured", "source", "label"],
				...statuses.map((s) => [
					s.provider,
					s.configured ? "yes" : "no",
					s.source ?? "",
					s.label ?? "",
				]),
			])}\n`;

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
