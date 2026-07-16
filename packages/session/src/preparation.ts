import { realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { SourceRecord } from "@plot/agent/model";
import { BoundaryError } from "@plot/common/boundary-error";
import { errorMessage, isRecord } from "@plot/common/primitives";
import type { Extension } from "@plot/sdk";
import * as sdk from "@plot/sdk";
import { createJiti } from "jiti/static";
import { createExtensionCredentials } from "./extension-credentials.js";
import {
	checkRequirements,
	extensionRequirements,
	sourceIdForExtension,
} from "./extension-source.js";
import {
	resolveSessionPaths,
	type SessionPathOptions,
	type SessionPaths,
} from "./paths.js";
import {
	assertWorkflowAgentReady,
	makeCreateAgentSession,
} from "./agent-session.js";
import type { CreateAgentSession } from "./agent-runner.js";
import {
	loadWorkflow,
	resolveWorkflowPath,
	WorkflowBoundaryError,
	type LoadedWorkflow,
} from "./workflow.js";
import type { PreparedWorkflow as PreparedSessionWorkflow } from "./workflow-plan.js";

const importExtension = (source: string): Promise<unknown> =>
	createJiti(import.meta.url, {
		moduleCache: false,
		tryNative: false,
		virtualModules: { "plot-ai/sdk": sdk },
	}).import(source);

const exportedExtension = (module: unknown): Extension | undefined => {
	if (!isRecord(module)) return;
	const extension = module["default"] ?? module["extension"];
	if (
		!isRecord(extension) ||
		typeof extension["id"] !== "string" ||
		typeof extension["create"] !== "function"
	)
		return;
	return extension as unknown as Extension;
};

const loadExtension = async (
	workflow: LoadedWorkflow,
	paths: SessionPaths,
): Promise<Extension> => {
	const source = workflow.runtime.extension.source;
	const path = isAbsolute(source)
		? source
		: resolve(workflow.path ? dirname(workflow.path) : paths.cwd, source);
	const extension = exportedExtension(await importExtension(path));
	if (extension === undefined)
		throw new Error(
			"extension module must export an Extension as default or extension",
		);
	return extension;
};

export interface PrepareWorkflowOptions extends SessionPathOptions {
	readonly workflowPath?: string;
	readonly skipAgentReadiness?: boolean;
	readonly createAgentSession?: CreateAgentSession;
}

export interface CheckedWorkflow {
	readonly workflowPath: string;
	readonly workflowName: string;
	readonly agent: { readonly provider: string; readonly model: string };
	readonly source: SourceRecord;
}

export const prepareWorkflowForSession = async (
	options: PrepareWorkflowOptions,
): Promise<PreparedSessionWorkflow> => {
	const paths = resolveSessionPaths(options);
	const requested = resolveWorkflowPath(options);
	let path: string;
	try {
		path = await realpath(requested);
	} catch (error) {
		throw new WorkflowBoundaryError({
			phase: "read",
			path: requested,
			message: errorMessage(error),
		});
	}
	const workflow = await loadWorkflow(path);
	if (
		options.skipAgentReadiness !== true &&
		options.createAgentSession === undefined
	)
		assertWorkflowAgentReady(workflow, paths);
	const extension = await loadExtension(workflow, paths);
	const input = workflow.runtime.extension.config;
	const extensionConfig = extension.parseConfig
		? await extension.parseConfig(input)
		: input;
	const credentials = createExtensionCredentials({
		extensionId: extension.id,
		workflow,
		paths,
	});
	const plan: PreparedSessionWorkflow["plan"] = {
		name: workflow.runtime.name ?? basename(path),
		agent: workflow.runtime.agent,
		plot: workflow.runtime.plot,
		prompt: workflow.prompt,
		extension,
		extensionConfig,
		maxConcurrentRuns: workflow.runtime.extension.maxConcurrentRuns ?? 1,
		definition: workflow.config,
	};
	return {
		identity: path,
		paths,
		credentials,
		createAgentSession:
			options.createAgentSession ?? makeCreateAgentSession({ workflow, paths }),
		dispose: () => {},
		plan,
	};
};

export const prepareWorkflow = async (
	options: PrepareWorkflowOptions,
): Promise<CheckedWorkflow> => {
	try {
		const prepared = await prepareWorkflowForSession(options);
		const runtime = await prepared.plan.extension.create({
			workflow: prepared.plan.definition,
			paths: prepared.paths,
			config: prepared.plan.extensionConfig,
			credentials: prepared.credentials,
		});
		const controller = new AbortController();
		try {
			const source = await checkRequirements({
				sourceId: sourceIdForExtension(prepared.plan.extension),
				label: prepared.plan.extension.label ?? prepared.plan.extension.id,
				requirements: extensionRequirements(runtime),
				credentials: prepared.credentials,
				signal: controller.signal,
			});
			return {
				workflowPath: prepared.identity as string,
				workflowName: prepared.plan.name,
				agent: {
					provider: prepared.plan.agent.provider,
					model: prepared.plan.agent.model,
				},
				source,
			};
		} finally {
			await runtime.shutdown?.({ signal: controller.signal });
		}
	} catch (error) {
		if (error instanceof BoundaryError) throw error;
		throw new WorkflowBoundaryError({
			phase: "prepare",
			path: resolveWorkflowPath(options),
			message: errorMessage(error),
		});
	}
};
