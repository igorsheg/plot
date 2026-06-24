import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
	resolvePlotPaths,
	type PlotPathOptions,
	type PlotPaths,
} from "../plot-paths.js";
import type { WorkflowAgentConfig } from "../workflow.js";
import { isRecord } from "../util.js";

export interface PlotSettings {
	readonly defaultProvider?: string;
	readonly defaultModel?: string;
	readonly defaultThinkingLevel?: WorkflowAgentConfig["thinking"];
}

export interface PlotSettingsPaths {
	readonly globalSettingsPath: string;
	readonly projectSettingsPath: string;
}

const readJsonObject = async (
	path: string,
): Promise<Record<string, unknown>> => {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { readonly code?: unknown }).code === "ENOENT"
		)
			return {};
		throw error;
	}
	const parsed = JSON.parse(text) as unknown;
	if (!isRecord(parsed)) throw new Error(`${path} must contain a JSON object`);
	return parsed;
};

const deepMerge = (
	base: Record<string, unknown>,
	override: Record<string, unknown>,
): Record<string, unknown> => {
	const result: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const existing = result[key];
		result[key] =
			isRecord(existing) && isRecord(value)
				? deepMerge(existing, value)
				: value;
	}
	return result;
};

const stringField = (record: Record<string, unknown>, field: string) =>
	typeof record[field] === "string" ? record[field] : undefined;

const thinkingField = (
	record: Record<string, unknown>,
	field: string,
): WorkflowAgentConfig["thinking"] => {
	const value = stringField(record, field);
	return value === "off" ||
		value === "minimal" ||
		value === "low" ||
		value === "medium" ||
		value === "high" ||
		value === "xhigh"
		? value
		: undefined;
};

const decodePlotSettings = (value: Record<string, unknown>): PlotSettings => {
	const settings: PlotSettings = {};
	const defaultProvider = stringField(value, "defaultProvider");
	const defaultModel = stringField(value, "defaultModel");
	const defaultThinkingLevel = thinkingField(value, "defaultThinkingLevel");
	if (defaultProvider !== undefined)
		Object.assign(settings, { defaultProvider });
	if (defaultModel !== undefined) Object.assign(settings, { defaultModel });
	if (defaultThinkingLevel !== undefined)
		Object.assign(settings, { defaultThinkingLevel });
	return settings;
};

export const plotSettingsPaths = (paths: PlotPaths): PlotSettingsPaths => ({
	// Plot keeps provider/model state under <plot-home>/agent, but the public
	// settings file sits at <plot-home>/settings.json.
	globalSettingsPath: resolve(paths.agentDir, "..", "settings.json"),
	projectSettingsPath: join(paths.plotDir, "settings.json"),
});

export const loadPlotSettings = async (
	options: PlotPathOptions | PlotPaths,
): Promise<PlotSettings> => {
	const paths = "skillsDir" in options ? options : resolvePlotPaths(options);
	const settingsPaths = plotSettingsPaths(paths);
	const [global, project] = await Promise.all([
		readJsonObject(settingsPaths.globalSettingsPath),
		readJsonObject(settingsPaths.projectSettingsPath),
	]);
	return decodePlotSettings(deepMerge(global, project));
};

export const plotSettingsForAgentSession = (
	settings: PlotSettings,
): Record<string, unknown> => ({
	...(settings.defaultProvider === undefined
		? {}
		: { defaultProvider: settings.defaultProvider }),
	...(settings.defaultModel === undefined
		? {}
		: { defaultModel: settings.defaultModel }),
	...(settings.defaultThinkingLevel === undefined
		? {}
		: { defaultThinkingLevel: settings.defaultThinkingLevel }),
});
