import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadPlotExtensionRuntimeFromWorkflow } from "./extension-source.js";
import {
	makePlotAuth,
	type PlotAuthStatusInfo,
	type PlotModelInfo,
} from "./pi-auth.js";
import {
	resolvePlotPaths,
	type PlotPathOptions,
	type PlotPaths,
} from "./plot-paths.js";
import type { PlotSettings } from "./plot-settings.js";
import {
	loadWorkflowFromNode,
	PlotWorkflowError,
	type WorkflowDefinition,
} from "./workflow.js";

export interface DynamicWorkflowForgeOptions extends PlotPathOptions {
	readonly goal: string;
	readonly outDir: string;
	readonly sessionId: string;
}

export interface DynamicWorkflowForgeWorkflow {
	readonly workflowPath: string;
	readonly text: string;
}

export interface DynamicWorkflowForgeModelCatalog {
	readonly availableModels: readonly PlotModelInfo[];
	readonly authStatus: readonly PlotAuthStatusInfo[];
	readonly error?: string;
}

export interface DynamicWorkflowValidation {
	readonly ok: boolean;
	readonly workflowPath: string;
	readonly extensionPath?: string;
	readonly errors: readonly string[];
	readonly warnings: readonly string[];
}

export interface DynamicWorkflowMetadata {
	readonly version: 1;
	readonly goal: string;
	readonly outDir: string;
	readonly workflowPath: string;
	readonly forgeSessionId: string;
	readonly createdAt: string;
	readonly validation: DynamicWorkflowValidation;
}

const forbiddenExtensionPatterns = [
	{
		pattern: /from\s+["']@plot\/(?:agent|session|cli)(?:\/[^"']*)?["']/g,
		message: "extension imports Plot internals",
	},
	{
		pattern: /from\s+["']@earendil-works\/pi-coding-agent["']/g,
		message: "extension imports an unsupported agent-session SDK directly",
	},
	{
		pattern: /\bcreateAgentSession\b/g,
		message: "extension creates agent sessions directly",
	},
	{
		pattern: /^\s*tools\s*:/gm,
		message:
			"extension declares a top-level tools property; call registerTool(...) inside create() instead",
	},
	{
		pattern: /\.streamDirectory\s*\(/g,
		message:
			"extension uses unsupported streamDirectory(); use node:fs/promises readdir",
	},
	{
		pattern: /catch\s*(?:\([^)]*\))?\s*{\s*return\s+\[\]\s*;?\s*}/g,
		message:
			"extension swallows discovery errors by returning []; let discovery fail or handle empty sources explicitly",
	},
];

export const dynamicWorkflowSlug = (goal: string): string => {
	const slug = goal
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return slug.length === 0 ? "workflow" : slug;
};

export const dynamicWorkflowOutDir = (options: {
	readonly cwd: string;
	readonly goal: string;
	readonly outDir?: string;
	readonly settings?: PlotSettings;
}): string => {
	const slug = dynamicWorkflowSlug(options.goal);
	const configuredBase = options.settings?.dynamic?.outDir;
	return resolve(
		options.cwd,
		options.outDir ?? join(configuredBase ?? "workflows", slug),
	);
};

const markdownFence = "```";

const dynamicForgeModelCatalog = async (
	paths: PlotPaths,
): Promise<DynamicWorkflowForgeModelCatalog> => {
	try {
		const auth = makePlotAuth(paths);
		const [models, authStatus] = await Promise.all([
			auth.listModels(),
			auth.status(),
		]);
		const configuredProviders = new Set(
			authStatus
				.filter((status) => status.configured)
				.map((status) => status.provider),
		);
		return {
			availableModels: models.filter((model) =>
				configuredProviders.has(model.provider),
			),
			authStatus,
		};
	} catch (error) {
		return {
			availableModels: [],
			authStatus: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
};

export const makeDynamicForgeExtensionText = (options: {
	readonly goal: string;
	readonly outDir: string;
	readonly sessionId: string;
	readonly modelCatalog: DynamicWorkflowForgeModelCatalog;
}): string => `import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { definePlotExtension, defineTool } from "plot-ai/sdk";
import {
	validateDynamicWorkflowBundle,
	writeDynamicWorkflowMetadata,
	type DynamicWorkflowValidation,
} from "plot-ai/internal/dynamic-workflow";

const goal = ${JSON.stringify(options.goal)};
const outDir = ${JSON.stringify(options.outDir)};
const forgeSessionId = ${JSON.stringify(options.sessionId)};
const modelCatalog = ${JSON.stringify(options.modelCatalog)};
const maxAttempts = 3;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export default definePlotExtension({
	id: "dynamic-workflow-forge",
	create({ registerTool, work, paths }) {
		let attempts = 0;
		let done = false;
		let validation: DynamicWorkflowValidation | null = null;
		const recordValidation = async (next: DynamicWorkflowValidation) => {
			validation = next;
			await writeDynamicWorkflowMetadata({
				goal,
				outDir,
				forgeSessionId,
				validation: next,
			});
		};
		registerTool(
			defineTool({
				name: "write_dynamic_workflow_bundle",
				label: "Write Dynamic Workflow Bundle",
				description:
					"Write the generated Plot WORKFLOW.md and workflow.extension.ts files to the approved output directory.",
				parameters: {
					type: "object",
					properties: {
						workflow: { type: "string" },
						extension: { type: "string" },
					},
					required: ["workflow", "extension"],
					additionalProperties: false,
				},
				execute: async (_id, params) => {
					if (!isRecord(params)) throw new Error("params must be an object");
					const workflow = params["workflow"];
					const extension = params["extension"];
					if (typeof workflow !== "string") throw new Error("workflow must be a string");
					if (typeof extension !== "string") throw new Error("extension must be a string");
					await mkdir(outDir, { recursive: true });
					await writeFile(join(outDir, "WORKFLOW.md"), workflow, "utf8");
					await writeFile(join(outDir, "workflow.extension.ts"), extension, "utf8");
					return {
						content: [{ type: "text" as const, text: "wrote dynamic workflow bundle to " + outDir }],
						details: { outDir },
					};
				},
			}),
		);
		return {
			async discover() {
				if (done || validation?.ok) return [];
				if (validation !== null && attempts >= maxAttempts) return [];
				const attempt = attempts + 1;
				return [
					work({
						id: "dynamic-workflow-bundle",
						version: String(attempt),
						title: validation === null ? "Generate dynamic workflow bundle" : "Repair dynamic workflow bundle",
						context: {
							goal,
							outDir,
							attempt,
							maxAttempts,
							validation,
							validationJson: JSON.stringify(validation, null, 2) ?? "null",
							modelCatalog,
							modelCatalogJson: JSON.stringify(modelCatalog, null, 2),
						},
					}),
				];
			},
			async completed() {
				attempts += 1;
				const next = await validateDynamicWorkflowBundle({
					cwd: paths.cwd,
					plotDir: paths.plotDir,
					agentDir: paths.agentDir,
					sessionDir: paths.sessionDir,
					outDir,
				});
				await recordValidation(next);
				if (next.ok || attempts >= maxAttempts) done = true;
			},
			async failed(event) {
				attempts += 1;
				await recordValidation({
					ok: false,
					workflowPath: join(outDir, "WORKFLOW.md"),
					errors: ["forge Agent Run failed: " + String(event.error)],
					warnings: [],
				});
				done = true;
			},
		};
	},
});
`;

export const makeDynamicForgeWorkflowText = (): string => `---
name: dynamic-workflow-forge
agent:
  maxTurns: 1
extension:
  source: ./forge.extension.ts
resources:
  contextFiles: true
---

You are Plot's Dynamic Workflow Forge. Generate or repair a normal Plot workflow bundle for this user goal:

{{ goal }}

Output directory:

{{ outDir }}

Attempt {{ attempt }} of {{ maxAttempts }}.

Previous validation result (null means this is the first attempt):

${markdownFence}json
{{ validationJson }}
${markdownFence}

Current configured Plot auth/model catalog:

${markdownFence}json
{{ modelCatalogJson }}
${markdownFence}

If validation is not null, repair the bundle so every validation error is addressed. Do not repeat the same invalid shape.

Call the registered tool write_dynamic_workflow_bundle exactly once with:

- workflow: the complete WORKFLOW.md text
- extension: the complete workflow.extension.ts text

Do not write WORKFLOW.md or workflow.extension.ts with shell/write/edit. The tool is the boundary that writes the approved files.

Hard contract:

- Use only the public SDK import inside the generated extension: ${markdownFence}ts
  import { definePlotExtension, defineTool } from "plot-ai/sdk";
  ${markdownFence}
- Do not import @plot/agent, @plot/session, @plot/cli, or any direct agent-session SDK.
- Do not create or spawn agent sessions from the extension.
- The extension discovers Work Items and optionally registers Plot tools.
- Register tools inside create({ registerTool }) by calling registerTool(...). Do not use a top-level tools property.
- Tool execute functions receive (_id, params); validate params before use.
- Use Node built-ins like node:fs/promises for filesystem work. Do not invent Bun-only filesystem APIs.
- Plot schedules Agent Runs through tick -> reconcile -> act.
- Keep work ids stable and versions domain-based.
- Source discovery owns done/retry state: if the workflow writes results, discover() must stop returning already-completed unchanged work by reading those results or another durable source.
- Do not swallow discovery errors into an empty work list unless an empty source is explicitly valid.
- If multiple Agent Runs would update the same file, set extension.maxConcurrentRuns: 1 or expose an idempotent registered tool for the write.
- Set plot.maxRunDurationMs to a reasonable wall-clock guard.
- Use agent.maxTurns to cap high-level Agent Run turns: one initial turn plus continuation turns on the same live agent session. Use 3 by default; raise only when the source is expected to need more continuation turns.
- agent.maxTurns does not cap the model/tool loop inside one turn; maxRunDurationMs is the coarse wall-clock bound.
- Keep generated context compact, but make sure the prompt renders it with template variables such as work.title or packagePath. Do not merely say "use Work Item context".
- If a registered tool records output for a Work Item, bind or validate the current work inside a tool factory; do not let the agent choose the target unchecked.
- Pick provider/model from the configured catalog only. If the goal needs a specific runtime model or capability, set agent.provider/model only to an entry in modelCatalog.availableModels; otherwise omit them and let Plot settings or CLI flags choose at run time.
- Do not invent provider/model ids, and do not choose providers with authStatus.configured=false. If you need to re-check, you may run plot list-models or plot auth status.
- Prefer one boring extension file. No speculative framework, no helper package, no barrel.

WORKFLOW.md shape:

${markdownFence}md
---
name: <stable-name>
extension:
  source: ./workflow.extension.ts
  maxConcurrentRuns: 1 # use 1 when Agent Runs update the same file; raise only when writes are safe
plot:
  tickIntervalMs: <reasonable-ms>
  maxRunDurationMs: <reasonable-ms>
agent:
  maxTurns: 3 # one initial turn plus continuation turns, not inner tool-loop steps
resources:
  contextFiles: true
---

# <task prompt>

Tell the Agent Run how to investigate and finish one Work Item. Render the Work Item's relevant template context explicitly, for example the work title or domain id/path. Mention registered tools by name if any.
${markdownFence}

Extension shape:

${markdownFence}ts
import { readdir } from "node:fs/promises";
import { definePlotExtension, defineTool } from "plot-ai/sdk";

export default definePlotExtension({
	id: "<stable-id>",
	create({ work, registerTool, paths }) {
		registerTool(defineTool({ name: "load_context", parameters: { type: "object", properties: {} }, execute: async () => ({ content: [{ type: "text", text: paths.cwd }] }) }));
		return {
			async discover() {
				await readdir(paths.cwd);
				return [work({ id: "demo:replace-me", title: "Replace me" })];
			},
		};
	},
});
${markdownFence}

After write_dynamic_workflow_bundle confirms the files were written, stop. Do not run the generated workflow.
`;

export const writeDynamicForgeWorkflow = async (
	options: DynamicWorkflowForgeOptions,
): Promise<DynamicWorkflowForgeWorkflow> => {
	const paths = resolvePlotPaths(options);
	const dir = join(paths.plotDir, "dynamic", "forge", options.sessionId);
	await mkdir(dir, { recursive: true });
	const workflowPath = join(dir, "WORKFLOW.md");
	const extensionPath = join(dir, "forge.extension.ts");
	const text = makeDynamicForgeWorkflowText();
	const modelCatalog = await dynamicForgeModelCatalog(paths);
	await Promise.all([
		writeFile(workflowPath, text, "utf8"),
		writeFile(
			extensionPath,
			makeDynamicForgeExtensionText({
				goal: options.goal,
				outDir: options.outDir,
				sessionId: options.sessionId,
				modelCatalog,
			}),
			"utf8",
		),
	]);
	return { workflowPath, text };
};

const extensionPathFor = (
	workflow: WorkflowDefinition,
	workflowPath: string,
): string | undefined => {
	const source = workflow.runtime.extension?.source;
	if (source === undefined || source.length === 0) return undefined;
	if (isAbsolute(source)) return source;
	if (
		source.includes(":") &&
		!source.startsWith("./") &&
		!source.startsWith("../")
	)
		return undefined;
	return resolve(dirname(workflow.path ?? workflowPath), source);
};

const staticExtensionErrors = async (
	extensionPath: string,
): Promise<string[]> => {
	const text = await readFile(extensionPath, "utf8");
	const errors: string[] = [];
	for (const { pattern, message } of forbiddenExtensionPatterns) {
		pattern.lastIndex = 0;
		if (pattern.test(text)) errors.push(message);
	}
	if (/\bdefineTool\s*\(/.test(text) && !/\bregisterTool\s*\(/.test(text)) {
		errors.push(
			"extension defines tools but never registers them with registerTool(...) inside create()",
		);
	}
	return [...new Set(errors)];
};

const promptDeclaredToolNames = (prompt: string): string[] => {
	const names = new Set<string>();
	for (const line of prompt.split(/\r?\n/)) {
		if (!/registered tools? available/i.test(line)) continue;
		for (const match of line.matchAll(/`([^`]+)`/g)) names.add(match[1]!);
	}
	return [...names];
};

const promptRendersWorkContext = (prompt: string): boolean =>
	/\{\{\s*(?:work\b|value\b|[A-Za-z_$][\w$]*\b)/.test(prompt);

const discoveredWorkHasContext = (
	discovered: readonly { readonly context?: unknown }[],
): boolean => discovered.some((work) => work.context !== undefined);

const fileExists = async (path: string): Promise<boolean> => {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { readonly code?: unknown }).code === "ENOENT"
		)
			return false;
		throw error;
	}
};

const missingGeneratedWorkflowError =
	"generated WORKFLOW.md was not written; the forge Agent Run must call write_dynamic_workflow_bundle";

export const validateDynamicWorkflowBundle = async (
	options: PlotPathOptions & { readonly outDir: string },
): Promise<DynamicWorkflowValidation> => {
	const workflowPath = join(options.outDir, "WORKFLOW.md");
	const errors: string[] = [];
	const warnings: string[] = [];
	let workflow: WorkflowDefinition | undefined;
	let extensionPath: string | undefined;
	if (!(await fileExists(workflowPath))) {
		return {
			ok: false,
			workflowPath,
			errors: [missingGeneratedWorkflowError],
			warnings,
		};
	}
	try {
		workflow = await loadWorkflowFromNode(workflowPath);
	} catch (error) {
		const message =
			error instanceof PlotWorkflowError && error.phase === "read"
				? missingGeneratedWorkflowError
				: error instanceof Error
					? error.message
					: String(error);
		return {
			ok: false,
			workflowPath,
			errors: [message],
			warnings,
		};
	}
	if (workflow.runtime.extension?.source === undefined) {
		errors.push("WORKFLOW.md must configure extension.source");
	} else {
		extensionPath = extensionPathFor(workflow, workflowPath);
		if (extensionPath === undefined) {
			errors.push("extension.source must point to a local TypeScript file");
		} else {
			try {
				errors.push(...(await staticExtensionErrors(extensionPath)));
			} catch (error) {
				errors.push(
					`failed to read extension: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	}
	if (
		workflow.runtime.agent?.provider !== undefined ||
		workflow.runtime.agent?.model !== undefined
	) {
		warnings.push(
			"generated workflow pins a runtime provider/model; omit them to use Plot settings fallback unless intentional",
		);
	}
	if (workflow.runtime.plot?.maxRunDurationMs === undefined) {
		warnings.push(
			"generated workflow has no plot.maxRunDurationMs; agent.maxTurns does not cap one turn's wall-clock time",
		);
	}
	if (errors.length === 0) {
		try {
			const loaded = await loadPlotExtensionRuntimeFromWorkflow({
				workflow,
				paths: resolvePlotPaths(options),
			});
			const declaredToolNames = promptDeclaredToolNames(workflow.prompt);
			const hasToolFactory = loaded.tools.some(
				(tool) => typeof tool === "function",
			);
			const registeredToolNames = new Set(
				loaded.tools.flatMap((tool) =>
					typeof tool === "function" ? [] : [tool.name],
				),
			);
			if (declaredToolNames.length > 0 && loaded.tools.length === 0) {
				errors.push(
					`workflow prompt mentions registered tool ${declaredToolNames.map((name) => `\`${name}\``).join(", ")} but extension registered no tools`,
				);
			} else if (!hasToolFactory) {
				for (const name of declaredToolNames) {
					if (!registeredToolNames.has(name))
						errors.push(
							`workflow prompt mentions registered tool \`${name}\` but extension did not register it`,
						);
				}
			}
			try {
				const discovered = await Promise.resolve(
					loaded.runtime.discover({ signal: new AbortController().signal }),
				);
				if (!Array.isArray(discovered)) {
					errors.push(
						"extension discover() must return an array of Work Items",
					);
				} else {
					if (
						discoveredWorkHasContext(discovered) &&
						!hasToolFactory &&
						!promptRendersWorkContext(workflow.prompt)
					) {
						errors.push(
							"workflow prompt does not render Work Item context; include template variables such as {{ work.title }} or context fields, or use a work-bound tool factory",
						);
					}
					if (discovered.length === 0) {
						warnings.push(
							"extension discovered no work during validation; check discovery inputs if that is unexpected",
						);
					}
				}
			} catch (error) {
				errors.push(
					`extension discover failed during validation: ${error instanceof Error ? error.message : String(error)}`,
				);
			} finally {
				await loaded.runtime.shutdown?.({
					signal: new AbortController().signal,
				});
			}
		} catch (error) {
			errors.push(
				`failed to load extension: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	return {
		ok: errors.length === 0,
		workflowPath,
		...(extensionPath === undefined ? {} : { extensionPath }),
		errors,
		warnings,
	};
};

export const readDynamicWorkflowMetadata = async (
	outDir: string,
): Promise<DynamicWorkflowMetadata | undefined> => {
	try {
		return JSON.parse(
			await readFile(join(outDir, "plot.dynamic.json"), "utf8"),
		) as DynamicWorkflowMetadata;
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			(error as { readonly code?: unknown }).code === "ENOENT"
		)
			return undefined;
		throw error;
	}
};

export const writeDynamicWorkflowMetadata = async (input: {
	readonly goal: string;
	readonly outDir: string;
	readonly forgeSessionId: string;
	readonly validation: DynamicWorkflowValidation;
}): Promise<DynamicWorkflowMetadata> => {
	const metadata: DynamicWorkflowMetadata = {
		version: 1,
		goal: input.goal,
		outDir: input.outDir,
		workflowPath: input.validation.workflowPath,
		forgeSessionId: input.forgeSessionId,
		createdAt: new Date().toISOString(),
		validation: input.validation,
	};
	await writeFile(
		join(input.outDir, "plot.dynamic.json"),
		`${JSON.stringify(metadata, null, 2)}\n`,
		"utf8",
	);
	return metadata;
};

export const relativeDynamicWorkflowPath = (
	cwd: string,
	path: string,
): string => {
	const value = relative(cwd, path);
	return value.length === 0 || value.startsWith("..") ? path : value;
};
