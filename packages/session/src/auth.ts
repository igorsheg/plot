import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import type {
	OAuthAuthInfo,
	OAuthDeviceCodeInfo,
	OAuthLoginCallbacks,
	OAuthPrompt,
	OAuthSelectPrompt,
} from "@earendil-works/pi-ai";
import {
	resolveSessionPaths,
	type SessionPathOptions,
	type SessionPaths,
} from "./paths.js";

export interface AuthProviderInfo {
	readonly id: string;
	readonly name: string;
	readonly usesCallbackServer: boolean;
	readonly configured: boolean;
	readonly source?: string;
	readonly label?: string;
}

export interface AuthStatusInfo {
	readonly provider: string;
	readonly configured: boolean;
	readonly source?: string;
	readonly label?: string;
}

export interface ModelInfo {
	readonly provider: string;
	readonly model: string;
	readonly context: number;
	readonly maxOutput: number;
	readonly thinking: boolean;
	readonly images: boolean;
}

export interface AuthLoginEventSink {
	readonly auth?: (info: OAuthAuthInfo) => void;
	readonly deviceCode?: (info: OAuthDeviceCodeInfo) => void;
	readonly prompt?: (prompt: OAuthPrompt) => void;
	readonly select?: (prompt: OAuthSelectPrompt) => void;
	readonly progress?: (message: string) => void;
}

export interface AuthLoginOptions {
	readonly provider: string;
	readonly promptResponses?: readonly string[];
	readonly promptInput?: (prompt: OAuthPrompt) => Promise<string>;
	readonly selectResponse?: string;
	readonly selectInput?: (
		prompt: OAuthSelectPrompt,
	) => Promise<string | undefined>;
	readonly manualCode?: string;
	readonly manualCodeInput?: () => Promise<string>;
	readonly events?: AuthLoginEventSink;
}

export interface SessionAuth {
	readonly providers: () => Promise<readonly AuthProviderInfo[]>;
	readonly listModels: (search?: string) => Promise<readonly ModelInfo[]>;
	readonly status: (provider?: string) => Promise<readonly AuthStatusInfo[]>;
	readonly login: (options: AuthLoginOptions) => Promise<void>;
	readonly logout: (provider: string) => Promise<void>;
}

const unique = (values: Iterable<string>): readonly string[] =>
	[...new Set([...values].filter((value) => value.length > 0))].toSorted();

const providerIds = (
	authStorage: AuthStorage,
	modelRegistry: ModelRegistry,
): readonly string[] =>
	unique([
		...authStorage.getOAuthProviders().map((provider) => provider.id),
		...authStorage.list(),
		...modelRegistry.getAll().map((model) => model.provider),
	]);

const statusFor = (
	modelRegistry: ModelRegistry,
	provider: string,
): AuthStatusInfo => {
	const status = modelRegistry.getProviderAuthStatus(provider);
	return {
		provider,
		configured: status.configured,
		...(status.source === undefined ? {} : { source: status.source }),
		...(status.label === undefined ? {} : { label: status.label }),
	};
};

const matchesModelSearch = (model: ModelInfo, search: string) => {
	const query = search.toLowerCase();
	return `${model.provider} ${model.model} ${model.provider}/${model.model}`
		.toLowerCase()
		.includes(query);
};

const makeCallbacks = (options: AuthLoginOptions): OAuthLoginCallbacks => {
	let promptIndex = 0;
	const onManualCodeInput =
		options.manualCodeInput ??
		(options.manualCode === undefined
			? undefined
			: async () => options.manualCode ?? "");
	return {
		onAuth: (info) => options.events?.auth?.(info),
		onDeviceCode: (info) => options.events?.deviceCode?.(info),
		onPrompt: async (prompt) => {
			options.events?.prompt?.(prompt);
			const response = options.promptResponses?.[promptIndex++];
			if (response !== undefined) return response;
			if (options.promptInput !== undefined) return options.promptInput(prompt);
			if (prompt.allowEmpty === true) return "";
			throw new Error("auth login requires prompt input");
		},
		onProgress: (message) => options.events?.progress?.(message),
		...(onManualCodeInput === undefined ? {} : { onManualCodeInput }),
		onSelect: async (prompt) => {
			options.events?.select?.(prompt);
			if (options.selectResponse !== undefined) return options.selectResponse;
			if (options.selectInput !== undefined) return options.selectInput(prompt);
			return prompt.options[0]?.id;
		},
	};
};

export const createSessionAuth = (
	input: SessionPathOptions | SessionPaths,
): SessionAuth => {
	const paths = "skillsDir" in input ? input : resolveSessionPaths(input);
	const authStorage = AuthStorage.create(join(paths.agentDir, "auth.json"));
	const modelRegistry = ModelRegistry.create(
		authStorage,
		join(paths.agentDir, "models.json"),
	);

	return {
		providers: async () => {
			modelRegistry.refresh();
			authStorage.reload();
			const oauthById = new Map(
				authStorage
					.getOAuthProviders()
					.map((provider) => [provider.id, provider]),
			);
			return providerIds(authStorage, modelRegistry).map((id) => {
				const status = modelRegistry.getProviderAuthStatus(id);
				const oauth = oauthById.get(id);
				return {
					id,
					name: oauth?.name ?? modelRegistry.getProviderDisplayName(id),
					usesCallbackServer: oauth?.usesCallbackServer ?? false,
					configured: status.configured,
					...(status.source === undefined ? {} : { source: status.source }),
					...(status.label === undefined ? {} : { label: status.label }),
				};
			});
		},
		listModels: async (search) => {
			modelRegistry.refresh();
			authStorage.reload();
			const models = modelRegistry
				.getAvailable()
				.map((model) => ({
					provider: model.provider,
					model: model.id,
					context: model.contextWindow,
					maxOutput: model.maxTokens,
					thinking: model.reasoning,
					images: model.input.includes("image"),
				}))
				.toSorted((left, right) => {
					const byProvider = left.provider.localeCompare(right.provider);
					if (byProvider !== 0) return byProvider;
					return left.model.localeCompare(right.model);
				});
			if (search === undefined || search.length === 0) return models;
			return models.filter((model) => matchesModelSearch(model, search));
		},
		status: async (provider) => {
			modelRegistry.refresh();
			authStorage.reload();
			const ids =
				provider === undefined
					? providerIds(authStorage, modelRegistry)
					: [provider];
			return ids.map((id) => statusFor(modelRegistry, id));
		},
		login: async (options) => {
			modelRegistry.refresh();
			authStorage.reload();
			await authStorage.login(options.provider, makeCallbacks(options));
			modelRegistry.refresh();
		},
		logout: async (provider) => {
			authStorage.reload();
			authStorage.logout(provider);
			modelRegistry.refresh();
		},
	};
};
