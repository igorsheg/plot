import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	registerFauxProvider,
	type FauxModelDefinition,
	type FauxProviderRegistration,
	type FauxResponseStep,
} from "@earendil-works/pi-ai";
import { resolvePlotPaths, type PlotPathOptions } from "../plot-paths.js";

export {
	fauxAssistantMessage,
	fauxText,
	fauxThinking,
	fauxToolCall,
	type FauxResponseStep,
} from "@earendil-works/pi-ai";

export interface PlotFauxProviderOptions {
	readonly api?: string;
	readonly provider?: string;
	readonly models?: readonly FauxModelDefinition[];
	readonly responses?: readonly FauxResponseStep[];
}

export interface PlotFauxProviderRegistration {
	readonly faux: FauxProviderRegistration;
	readonly api: string;
	readonly provider: string;
	readonly modelId: string;
	readonly modelName: string;
	readonly getModel: FauxProviderRegistration["getModel"];
	readonly setResponses: (responses: readonly FauxResponseStep[]) => void;
	readonly appendResponses: (responses: readonly FauxResponseStep[]) => void;
	readonly getPendingResponseCount: () => number;
	readonly cleanup: () => void;
}

export interface WritePlotFauxAgentFilesOptions extends PlotPathOptions {
	readonly api?: string;
	readonly provider?: string;
	readonly modelId?: string;
	readonly modelName?: string;
	readonly apiKeyEnvVar?: string;
}

const DEFAULT_API = "faux";
const DEFAULT_API_KEY_ENV_VAR = "PLOT_FAUX_API_KEY";
const DEFAULT_PROVIDER = "plot-faux";
const DEFAULT_MODEL_ID = "faux-1";
const DEFAULT_MODEL_NAME = "Faux Model";

export const registerPlotFauxProvider = (
	options: PlotFauxProviderOptions = {},
): PlotFauxProviderRegistration => {
	const faux = registerFauxProvider({
		api: options.api ?? DEFAULT_API,
		provider: options.provider ?? DEFAULT_PROVIDER,
		...(options.models === undefined ? {} : { models: [...options.models] }),
	});
	faux.setResponses([...(options.responses ?? [])]);
	const model = faux.getModel();
	return {
		faux,
		api: faux.api,
		provider: model.provider,
		modelId: model.id,
		modelName: model.name,
		getModel: faux.getModel,
		setResponses: (responses) => faux.setResponses([...responses]),
		appendResponses: (responses) => faux.appendResponses([...responses]),
		getPendingResponseCount: faux.getPendingResponseCount,
		cleanup: () => faux.unregister(),
	};
};

export const writePlotFauxAgentFiles = async (
	options: WritePlotFauxAgentFilesOptions,
) => {
	const paths = resolvePlotPaths(options);
	const provider = options.provider ?? DEFAULT_PROVIDER;
	const modelId = options.modelId ?? DEFAULT_MODEL_ID;
	const api = options.api ?? DEFAULT_API;
	const modelName = options.modelName ?? DEFAULT_MODEL_NAME;
	const apiKeyEnvVar = options.apiKeyEnvVar ?? DEFAULT_API_KEY_ENV_VAR;
	await mkdir(paths.agentDir, { recursive: true });
	await Promise.all([
		mkdir(paths.sessionDir, { recursive: true }),
		mkdir(paths.skillsDir, { recursive: true }),
		mkdir(paths.extensionsDir, { recursive: true }),
		mkdir(paths.promptsDir, { recursive: true }),
	]);
	await writeFile(
		join(paths.agentDir, "models.json"),
		`${JSON.stringify(
			{
				providers: {
					[provider]: {
						name: "Plot Faux",
						baseUrl: "http://localhost:0",
						apiKey: `$${apiKeyEnvVar}`,
						api,
						models: [
							{
								id: modelId,
								name: modelName,
								reasoning: false,
							},
						],
					},
				},
			},
			null,
			2,
		)}\n`,
	);
	await writeFile(
		join(paths.agentDir, "settings.json"),
		`${JSON.stringify(
			{
				defaultProvider: provider,
				defaultModel: modelId,
			},
			null,
			2,
		)}\n`,
	);
	return paths;
};
