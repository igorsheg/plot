import { MessageChannel } from "node:worker_threads";
import { BoundaryError } from "@plot/common/boundary-error";
import { errorMessage } from "@plot/common/primitives";
import type { TickResult as AgentTickResult } from "@plot/agent/model";
import type { OperatorActionInput, Workflow } from "@plot/sdk";
import type {
	SessionState,
	SourceActionInput,
	SourceActionStartResult,
} from "@plot/sdk/runtime-contract";
import { createMemorySessionEventStore } from "@plot/session/history-memory";
import { createSessionHost, type SessionHost } from "@plot/session/host";
import {
	createOwner,
	type Owner,
	type SessionCloseContext,
	type SessionIdentity,
} from "@plot/session/owner";
import {
	createMemoryExtensionCredentials,
	prepareWorkflowValue,
	type ProviderCredentials,
} from "@plot/session/workflow-value";
import {
	ObservationOwner,
	type Diagnostic,
	type SessionObservation,
} from "./observation.js";

export type { OperatorActionInput } from "@plot/sdk";
export type {
	SessionState,
	SourceActionInput,
	SourceActionStartResult,
} from "@plot/sdk/runtime-contract";

export type {
	ActionConfirmationSnapshot,
	ActionSnapshot,
	AgentRunSnapshot,
	CompletedWorkSnapshot,
	Diagnostic,
	SessionObservation,
	SessionSnapshot,
	SourceActionSnapshot,
	SourceRequirementSnapshot,
	SourceSnapshot,
	UsageSnapshot,
	WorkItemSnapshot,
} from "./observation.js";

export interface ProviderCredential {
	readonly type: "api-key";
	readonly apiKey: string;
}

export interface CreatePlotOptions {
	readonly cwd?: string;
	readonly credentials?: Readonly<Record<string, ProviderCredential>>;
}

export interface TickResult {
	readonly tickId: number;
	readonly selected: number;
	readonly started: number;
	readonly completed: number;
	readonly activeAgentRuns: number;
	readonly diagnostics: readonly Diagnostic[];
}

export interface Session<Config = unknown> {
	readonly id: string;
	readonly workflow: Workflow<Config>;
	readonly state: SessionState;
	readonly tick: () => Promise<TickResult>;
	readonly startSourceAction: (
		input: SourceActionInput,
	) => Promise<SourceActionStartResult>;
	readonly cancelSourceAction: (actionRunId: string) => Promise<boolean>;
	readonly performOperatorAction: (
		input: OperatorActionInput,
	) => Promise<boolean>;
	readonly observe: () => SessionObservation;
	readonly stop: () => Promise<void>;
}

export interface Plot {
	readonly start: <Config>(
		workflow: Workflow<Config>,
	) => Promise<Session<Config>>;
	readonly find: <Config>(
		workflow: Workflow<Config>,
	) => Session<Config> | undefined;
	readonly sessions: () => readonly Session<unknown>[];
	readonly dispose: () => Promise<void>;
}

export class RuntimeError extends Error {
	override readonly name = "RuntimeError";
	readonly code: string;
	readonly retryable: boolean;
	readonly context:
		| Readonly<Record<string, string | number | boolean | null>>
		| undefined;

	constructor(input: {
		readonly code: string;
		readonly message: string;
		readonly retryable?: boolean;
		readonly context?: Readonly<
			Record<string, string | number | boolean | null>
		>;
		readonly cause?: unknown;
	}) {
		super(input.message, { cause: input.cause });
		this.code = input.code;
		this.retryable = input.retryable ?? false;
		this.context = input.context;
	}
}

const publicError = (error: unknown): RuntimeError => {
	if (error instanceof RuntimeError) return error;
	if (error instanceof BoundaryError)
		return new RuntimeError({
			code: error.code,
			message: error.message,
			retryable: error.retryable,
			context: error.context,
			cause: error,
		});
	return new RuntimeError({
		code: "runtime_error",
		message: errorMessage(error),
		cause: error,
	});
};

const tickResult = (result: AgentTickResult): TickResult => ({
	tickId: result.tickId,
	selected: result.selected,
	started: result.started,
	completed: result.completions,
	activeAgentRuns: result.running,
	diagnostics: result.diagnostics.map((diagnostic) => ({
		message: diagnostic.message,
	})),
});

class Keepalive {
	private count = 0;
	private channel: MessageChannel | undefined;

	acquire(): void {
		this.count++;
		if (this.channel !== undefined) return;
		this.channel = new MessageChannel();
		this.channel.port1.on("message", () => {});
	}

	release(): void {
		this.count--;
		if (this.count > 0) return;
		this.close();
	}

	close(): void {
		this.count = 0;
		this.channel?.port1.close();
		this.channel?.port2.close();
		this.channel = undefined;
	}
}

type AnyWorkflow = Workflow<unknown>;

class InProcessSession implements Session<unknown> {
	private currentState: SessionState = "starting";

	constructor(
		readonly workflow: AnyWorkflow,
		private readonly identity: SessionIdentity<AnyWorkflow>,
		readonly host: SessionHost,
		readonly observation: ObservationOwner,
		private readonly owner: Owner<AnyWorkflow, AnyWorkflow, InProcessSession>,
		private readonly releaseKeepalive: () => void,
	) {}

	get id(): string {
		return this.host.runtime.id;
	}

	get state(): SessionState {
		return this.currentState;
	}

	online(): void {
		this.currentState = "online";
	}

	stopping(): void {
		this.currentState = "stopping";
		this.observation.setStatus("stopping");
	}

	stopped(): void {
		this.currentState = "stopped";
		this.observation.setStatus("stopped");
		this.observation.finish();
	}

	failed(): void {
		this.currentState = "error";
		this.observation.setStatus("error");
		this.observation.finish();
	}

	async tick(): Promise<TickResult> {
		this.assertControllable("tick");
		try {
			return tickResult(await this.host.runtime.tickOnce());
		} catch (error) {
			throw publicError(error);
		}
	}

	async startSourceAction(
		input: SourceActionInput,
	): Promise<SourceActionStartResult> {
		this.assertControllable("start a Source action");
		try {
			return await this.host.runtime.startSourceAction(input);
		} catch (error) {
			throw publicError(error);
		}
	}

	async cancelSourceAction(actionRunId: string): Promise<boolean> {
		this.assertControllable("cancel a Source action");
		try {
			return this.host.runtime.cancelSourceAction(actionRunId);
		} catch (error) {
			throw publicError(error);
		}
	}

	async performOperatorAction(input: OperatorActionInput): Promise<boolean> {
		this.assertControllable("perform an Operator action");
		try {
			return this.host.runtime.recordOperatorObservation(input);
		} catch (error) {
			throw publicError(error);
		}
	}

	observe(): SessionObservation {
		return this.observation.open();
	}

	async stop(): Promise<void> {
		await this.owner.stopOwned(this.identity, this);
	}

	async close(_context: SessionCloseContext): Promise<void> {
		this.stopping();
		try {
			await this.host.shutdown();
			this.stopped();
		} catch (error) {
			this.failed();
			throw publicError(error);
		} finally {
			this.releaseKeepalive();
		}
	}

	private assertControllable(operation: string): void {
		if (
			this.currentState === "online" &&
			this.owner.isControllable(this.identity, this)
		)
			return;
		throw new RuntimeError({
			code: "session_not_controllable",
			message: `Session ${this.id} is ${this.currentState}; cannot ${operation}.`,
			context: { sessionId: this.id, state: this.currentState },
		});
	}
}

class InProcessPlot implements Plot {
	private readonly owner: Owner<AnyWorkflow, AnyWorkflow, InProcessSession>;
	private readonly extensionCredentials = new Map<
		AnyWorkflow,
		ReturnType<typeof createMemoryExtensionCredentials>
	>();
	private readonly keepalive = new Keepalive();
	private disposal: Promise<void> | undefined;

	constructor(
		private readonly cwd: string,
		private readonly providerCredentials: ProviderCredentials,
	) {
		this.owner = createOwner(
			async ({ target, identity }) => {
				this.keepalive.acquire();
				try {
					return await this.createInProcessSession(target, identity);
				} catch (error) {
					this.keepalive.release();
					throw error;
				}
			},
			() =>
				new RuntimeError({
					code: "runtime_disposed",
					message: "Plot is disposing or disposed.",
				}),
		);
	}

	async start<Config>(workflow: Workflow<Config>): Promise<Session<Config>> {
		const value = workflow as unknown as AnyWorkflow;
		try {
			const result = await this.owner.start({
				key: value,
				target: value,
			});
			return result.session as unknown as Session<Config>;
		} catch (error) {
			throw publicError(error);
		}
	}

	find<Config>(workflow: Workflow<Config>): Session<Config> | undefined {
		return this.owner.find([workflow as unknown as AnyWorkflow]) as
			| Session<Config>
			| undefined;
	}

	sessions(): readonly Session<unknown>[] {
		return this.owner.sessions();
	}

	dispose(): Promise<void> {
		this.disposal ??= (async () => {
			let failure: unknown;
			try {
				await this.owner.dispose();
			} catch (error) {
				failure = error;
			} finally {
				for (const credentials of this.extensionCredentials.values())
					credentials.clear();
				this.extensionCredentials.clear();
				for (const provider of Object.keys(this.providerCredentials))
					delete this.providerCredentials[provider];
				this.keepalive.close();
			}
			if (failure !== undefined) throw publicError(failure);
		})();
		return this.disposal;
	}

	private async createInProcessSession(
		workflow: AnyWorkflow,
		identity: SessionIdentity<AnyWorkflow>,
	): Promise<InProcessSession> {
		let credentials = this.extensionCredentials.get(workflow);
		if (credentials === undefined) {
			credentials = createMemoryExtensionCredentials();
			this.extensionCredentials.set(workflow, credentials);
		}
		const prepared = await prepareWorkflowValue({
			cwd: this.cwd,
			workflow,
			providerCredentials: this.providerCredentials,
			extensionCredentials: credentials,
		});
		const host = await createSessionHost({
			prepared,
			createEventStore: () => createMemorySessionEventStore(),
		});
		const observation = new ObservationOwner(
			host.runtime.id,
			workflow.name,
			this.cwd,
		);
		const unsubscribe = host.events.subscribe((event) =>
			observation.accept(event),
		);
		const session = new InProcessSession(
			workflow,
			identity,
			host,
			observation,
			this.owner,
			() => this.keepalive.release(),
		);
		try {
			await host.runtime.start();
			session.online();
			return session;
		} catch (error) {
			unsubscribe();
			await host.shutdown().catch(() => undefined);
			session.failed();
			throw error;
		}
	}
}

export const createPlot = async (
	options: CreatePlotOptions = {},
): Promise<Plot> => {
	const credentials = Object.fromEntries(
		Object.entries(options.credentials ?? {}).map(([provider, credential]) => [
			provider,
			{ apiKey: credential.apiKey },
		]),
	);
	return new InProcessPlot(options.cwd ?? process.cwd(), credentials);
};
