import type { AuthStatusInfo, ModelInfo } from "@plot/session/auth";

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
