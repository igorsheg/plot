import { Effect } from "effect";
import type { WorkflowConfig } from "@plot/sdk";
import { ConfigValidationError } from "../schemas/errors.js";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { WorkflowOverrides } from "../config.js";

const resolveEnvValue = (value: string | undefined): string | undefined => {
	if (!value) return undefined;
	if (value.startsWith("$")) {
		const envKey = value.slice(1);
		const resolved = process.env[envKey];
		return resolved || undefined;
	}
	return value;
};

const resolvePath = (value: string | undefined, fallback: string): string => {
	if (!value) return fallback;
	const resolved = resolveEnvValue(value) ?? value;
	if (resolved.startsWith("~")) {
		return resolve(process.env["HOME"] ?? "/", resolved.slice(1));
	}
	if (resolved.includes("/") || resolved.includes("\\")) {
		return resolve(resolved);
	}
	return resolved;
};

export class ResolvedConfig {
	readonly trackerKind: string;
	readonly trackerEndpoint: string;
	readonly trackerApiKey: string | undefined;
	readonly trackerProjectSlug: string | undefined;
	readonly trackerPluginConfig: Record<string, unknown>;
	readonly dispatchStates: ReadonlyArray<string>;
	readonly parkedStates: ReadonlyArray<string>;
	readonly terminalStates: ReadonlyArray<string>;
	readonly pollIntervalMs: number;
	readonly workspaceRoot: string;
	readonly hooksAfterCreate: string | undefined;
	readonly hooksBeforeRun: string | undefined;
	readonly hooksAfterRun: string | undefined;
	readonly hooksBeforeRemove: string | undefined;
	readonly hooksTimeoutMs: number;
	readonly maxConcurrentAgents: number;
	readonly maxTurns: number;
	readonly maxRetryBackoffMs: number;
	readonly maxConcurrentAgentsByState: ReadonlyMap<string, number>;
	readonly model: string | undefined;
	readonly modelByState: ReadonlyMap<string, string>;
	readonly agentCommand: string;
	readonly turnTimeoutMs: number;
	readonly readTimeoutMs: number;
	readonly stallTimeoutMs: number;
	readonly serverPort: number | undefined;
	readonly githubRepo: string;

	constructor(wf: WorkflowConfig, overrides?: WorkflowOverrides) {
		this.trackerKind = overrides?.trackerKind ?? wf.tracker?.kind ?? "github";
		this.trackerEndpoint = wf.tracker?.endpoint ?? "";
		this.trackerApiKey = resolveEnvValue(wf.tracker?.apiKey);
		this.trackerProjectSlug = wf.tracker?.projectSlug;
		this.trackerPluginConfig = { ...(wf.tracker ?? {}) };
		this.dispatchStates = wf.tracker?.dispatchStates ?? [
			"plot:todo",
			"plot:in-progress",
		];
		this.parkedStates = wf.tracker?.parkedStates ?? ["plot:human-review"];
		this.terminalStates = wf.tracker?.terminalStates ?? [
			"Closed",
			"Cancelled",
			"Canceled",
			"Duplicate",
			"plot:done",
		];
		this.pollIntervalMs = wf.polling?.intervalMs ?? 30_000;
		this.workspaceRoot = resolvePath(
			wf.workspace?.root,
			resolve(tmpdir(), "plot_workspaces"),
		);
		this.hooksAfterCreate = wf.hooks?.afterCreate;
		this.hooksBeforeRun = wf.hooks?.beforeRun;
		this.hooksAfterRun = wf.hooks?.afterRun;
		this.hooksBeforeRemove = wf.hooks?.beforeRemove;
		this.hooksTimeoutMs =
			(wf.hooks?.timeoutMs ?? 60_000) > 0
				? (wf.hooks?.timeoutMs ?? 60_000)
				: 60_000;
		this.maxConcurrentAgents = wf.agent?.maxConcurrentAgents ?? 10;
		this.maxTurns = wf.agent?.maxTurns ?? 20;
		this.maxRetryBackoffMs = wf.agent?.maxRetryBackoffMs ?? 300_000;
		const byState = new Map<string, number>();
		if (wf.agent?.maxConcurrentAgentsByState) {
			for (const [k, v] of Object.entries(
				wf.agent.maxConcurrentAgentsByState,
			)) {
				if (typeof v === "number" && v > 0) {
					byState.set(k.trim().toLowerCase(), v);
				}
			}
		}
		this.maxConcurrentAgentsByState = byState;
		this.model = wf.agent?.model;
		const byStateModel = new Map<string, string>();
		if (wf.agent?.modelByState) {
			for (const [k, v] of Object.entries(wf.agent.modelByState)) {
				if (typeof v === "string" && v.length > 0) {
					byStateModel.set(k.trim().toLowerCase(), v);
				}
			}
		}
		this.modelByState = byStateModel;
		this.agentCommand = wf.codex?.command ?? "pi";
		this.turnTimeoutMs = wf.codex?.turnTimeoutMs ?? 3_600_000;
		this.readTimeoutMs = wf.codex?.readTimeoutMs ?? 5_000;
		this.stallTimeoutMs = wf.codex?.stallTimeoutMs ?? 300_000;
		this.serverPort = wf.server?.port;
		this.githubRepo = overrides?.githubRepo ?? "";
	}

	resolveModelSpec(issueState: string): string | undefined {
		const normalized = issueState.trim().toLowerCase();
		return this.modelByState.get(normalized) ?? this.model;
	}
}

export const validateForDispatch = (
	config: ResolvedConfig,
): Effect.Effect<void, ConfigValidationError> =>
	Effect.gen(function* () {
		if (!config.trackerKind) {
			return yield* new ConfigValidationError({
				message: "tracker.kind is required",
				field: "tracker.kind",
			});
		}
	});
