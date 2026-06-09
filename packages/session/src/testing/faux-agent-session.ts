import {
	AuthStorage,
	createAgentSession,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type CreateAgentSessionOptions,
	type CreateAgentSessionResult,
} from "@earendil-works/pi-coding-agent";
import {
	registerFauxProvider,
	type FauxModelDefinition,
	type FauxProviderRegistration,
	type FauxResponseStep,
	type Model,
} from "@earendil-works/pi-ai";
import type { CreateAgentSession } from "../agent-session-client.js";

export {
	fauxAssistantMessage,
	fauxText,
	fauxThinking,
	fauxToolCall,
	type FauxResponseStep,
} from "@earendil-works/pi-ai";

export interface FauxAgentSessionHarnessOptions {
	readonly models?: readonly FauxModelDefinition[];
	readonly responses?: readonly FauxResponseStep[];
	readonly cwd?: string;
	readonly apiKey?: string;
	readonly disableBuiltinTools?: boolean;
}

export interface FauxAgentSessionHarness {
	readonly faux: FauxProviderRegistration;
	readonly authStorage: AuthStorage;
	readonly modelRegistry: ModelRegistry;
	readonly sessionManager: SessionManager;
	readonly settingsManager: SettingsManager;
	readonly models: readonly [Model<string>, ...Model<string>[]];
	readonly getModel: FauxProviderRegistration["getModel"];
	readonly setResponses: (responses: readonly FauxResponseStep[]) => void;
	readonly appendResponses: (responses: readonly FauxResponseStep[]) => void;
	readonly getPendingResponseCount: () => number;
	readonly createAgentSession: CreateAgentSession;
	readonly cleanup: () => void;
}

const DEFAULT_API_KEY = "plot-faux-key";

const registerModels = (
	registry: ModelRegistry,
	faux: FauxProviderRegistration,
	apiKey: string,
) => {
	const model = faux.getModel();
	registry.registerProvider(model.provider, {
		baseUrl: model.baseUrl,
		apiKey,
		api: faux.api,
		models: faux.models.map((registeredModel) => ({
			id: registeredModel.id,
			name: registeredModel.name,
			api: registeredModel.api,
			reasoning: registeredModel.reasoning,
			input: registeredModel.input,
			cost: registeredModel.cost,
			contextWindow: registeredModel.contextWindow,
			maxTokens: registeredModel.maxTokens,
			baseUrl: registeredModel.baseUrl,
		})),
	});
};

export const createFauxAgentSessionHarness = (
	options: FauxAgentSessionHarnessOptions = {},
): FauxAgentSessionHarness => {
	const faux = registerFauxProvider({
		provider: "plot-faux",
		...(options.models === undefined ? {} : { models: [...options.models] }),
	});
	faux.setResponses([...(options.responses ?? [])]);

	const model = faux.getModel();
	const apiKey = options.apiKey ?? DEFAULT_API_KEY;
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(model.provider, apiKey);
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	registerModels(modelRegistry, faux, apiKey);

	const sessionManager = SessionManager.inMemory(options.cwd);
	const settingsManager = SettingsManager.inMemory({
		defaultProvider: model.provider,
		defaultModel: model.id,
	});

	const createFauxAgentSession = (
		request?: CreateAgentSessionOptions,
	): Promise<CreateAgentSessionResult> => {
		const cwd = request?.cwd ?? options.cwd;
		const noTools =
			request?.noTools ??
			(options.disableBuiltinTools === false ? undefined : "all");
		return createAgentSession({
			...request,
			...(cwd === undefined ? {} : { cwd }),
			model,
			authStorage,
			modelRegistry,
			sessionManager,
			settingsManager,
			...(noTools === undefined ? {} : { noTools }),
		});
	};

	return {
		faux,
		authStorage,
		modelRegistry,
		sessionManager,
		settingsManager,
		models: faux.models,
		getModel: faux.getModel,
		setResponses: (responses) => faux.setResponses([...responses]),
		appendResponses: (responses) => faux.appendResponses([...responses]),
		getPendingResponseCount: faux.getPendingResponseCount,
		createAgentSession: createFauxAgentSession,
		cleanup: () => faux.unregister(),
	};
};
