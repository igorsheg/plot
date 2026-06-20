import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { defineCommand } from "citty";
import {
	dynamicWorkflowOutDir,
	dynamicWorkflowSlug,
	readDynamicWorkflowMetadata,
	relativeDynamicWorkflowPath,
	writeDynamicForgeWorkflow,
} from "@plot/session/dynamic-workflow";
import { connectLocalControlClient } from "@plot/session/local-control-client";
import { loadPlotSettings } from "@plot/session/plot-settings";
import {
	agentOverrideArgs,
	loggingArgs,
	pathArgs,
	resourceArgs,
	runtimeArgs,
} from "../args.js";
import { getCliIo } from "../cli-context.js";
import { errorMessage, type PlotCliIo, writeCliStderr } from "../io.js";
import { baseOptions, bool, str } from "../options.js";
import { runControlOneshot, runInProcessOnce } from "../runtime.js";

const exists = async (path: string): Promise<boolean> => {
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

const ensureWritableOutDir = async (outDir: string, force: boolean) => {
	if (!force) {
		const existing = await Promise.all([
			exists(join(outDir, "WORKFLOW.md")),
			exists(join(outDir, "workflow.extension.ts")),
		]);
		if (existing.some(Boolean))
			throw new Error(
				`${outDir} already contains a dynamic workflow; pass --force to overwrite`,
			);
	}
	await mkdir(outDir, { recursive: true });
};

type ForgeRunOptions = ReturnType<typeof baseOptions> & {
	readonly workflowPath: string;
};

const startGeneratedWorkflow = async (input: {
	readonly cwd: string;
	readonly workflowPath: string;
	readonly sessionId: string;
	readonly plotDir?: string;
	readonly agentDir?: string;
	readonly sessionDir?: string;
}) => {
	const client = await connectLocalControlClient({ cwd: input.cwd });
	try {
		await client.openSession({
			sessionId: input.sessionId,
			cwd: input.cwd,
			workflowPath: input.workflowPath,
			mode: "watch",
			lifetime: "server",
			role: "controller",
			...(input.plotDir === undefined ? {} : { plotDir: input.plotDir }),
			...(input.agentDir === undefined ? {} : { agentDir: input.agentDir }),
			...(input.sessionDir === undefined
				? {}
				: { sessionDir: input.sessionDir }),
		});
	} finally {
		client.close();
	}
};

const runForgeTui = async (input: {
	readonly io: PlotCliIo;
	readonly forgeRun: ForgeRunOptions;
	readonly noServer: boolean;
}) => {
	const runTui =
		input.io.runTui ?? (await import("@plot/tui/plot-tui")).runPlotTui;
	await runTui({
		...input.forgeRun,
		mode: "oneshot",
		lifetime: "server",
		...(input.noServer ? { noServer: true } : {}),
		...(input.io.createAgentSession === undefined
			? {}
			: { createAgentSession: input.io.createAgentSession }),
	});
};

export const dynamicCommand = defineCommand({
	meta: {
		name: "dynamic",
		description: "Generate a Plot Workflow + Extension from a goal.",
	},
	args: {
		goal: {
			type: "positional",
			description: "What the generated Plot workflow should do.",
			required: true,
		},
		out: {
			type: "string",
			description:
				"Output directory. Default: Plot settings dynamic.outDir/<goal-slug> or workflows/<goal-slug>.",
			valueHint: "path",
		},
		force: {
			type: "boolean",
			description:
				"Allow overwriting WORKFLOW.md and workflow.extension.ts in --out.",
		},
		start: {
			type: "boolean",
			description:
				"Start the generated workflow as a watch Plot Session after validation.",
		},
		tui: {
			type: "boolean",
			description: "Open the TUI while the forge workflow runs.",
		},
		"no-server": {
			type: "boolean",
			description:
				"Run the forge in-process instead of through the Local Plot Server.",
		},
		"session-id": {
			type: "string",
			description: "Forge Plot Session id.",
			valueHint: "id",
		},
		...pathArgs,
		...loggingArgs,
		...runtimeArgs,
		...agentOverrideArgs,
		...resourceArgs,
	},
	async run({ args }) {
		const io = getCliIo();
		const goal = str(args, "goal");
		if (goal === undefined) throw new Error("dynamic requires a goal");
		const base = baseOptions(args);
		const settings = await loadPlotSettings({
			cwd: base.cwd,
			...(base.plotDir === undefined ? {} : { plotDir: base.plotDir }),
			...(base.agentDir === undefined ? {} : { agentDir: base.agentDir }),
			...(base.sessionDir === undefined ? {} : { sessionDir: base.sessionDir }),
		});
		const outDir = dynamicWorkflowOutDir({
			cwd: base.cwd,
			goal,
			settings,
			...(str(args, "out") === undefined ? {} : { outDir: str(args, "out")! }),
		});
		const slug = dynamicWorkflowSlug(goal);
		const forgeSessionId =
			str(args, "session-id") ??
			`dynamic-forge-${slug}-${randomUUID().slice(0, 8)}`;
		const noServer = bool(args, "no-server") ?? false;
		const useTui = bool(args, "tui") ?? false;
		try {
			await ensureWritableOutDir(outDir, bool(args, "force") ?? false);
			const forge = await writeDynamicForgeWorkflow({
				cwd: base.cwd,
				...(base.plotDir === undefined ? {} : { plotDir: base.plotDir }),
				...(base.agentDir === undefined ? {} : { agentDir: base.agentDir }),
				...(base.sessionDir === undefined
					? {}
					: { sessionDir: base.sessionDir }),
				goal,
				outDir,
				sessionId: forgeSessionId,
			});
			await io.writeStdout(
				`forging ${relativeDynamicWorkflowPath(base.cwd, outDir)}\n`,
			);
			const forgeRun = {
				...base,
				sessionId: forgeSessionId,
				workflowPath: forge.workflowPath,
			};
			if (useTui) {
				await io.writeStdout(`opening TUI for ${forgeSessionId}\n`);
				await runForgeTui({ io, forgeRun, noServer });
			} else if (noServer || io.createAgentSession !== undefined) {
				await runInProcessOnce({
					...forgeRun,
					...(io.createAgentSession === undefined
						? {}
						: { createAgentSession: io.createAgentSession }),
				});
			} else {
				await io.writeStdout(
					`watch: plot tui --session-id ${forgeSessionId}\n`,
				);
				await runControlOneshot(forgeRun);
			}
			const metadata = await readDynamicWorkflowMetadata(outDir);
			if (metadata === undefined) {
				if (useTui)
					await writeCliStderr(
						io,
						`Dynamic forge has not finished; reopen with: plot tui --session-id ${forgeSessionId}\n`,
					);
				throw new Error("dynamic forge did not write validation metadata");
			}
			const { validation } = metadata;
			await Promise.all(
				validation.warnings.map((warning) =>
					writeCliStderr(io, `Warning: ${warning}\n`),
				),
			);
			if (!validation.ok) {
				await writeCliStderr(
					io,
					`Dynamic workflow validation failed:\n${validation.errors.map((e) => `- ${e}`).join("\n")}\n`,
				);
				throw new Error("dynamic workflow validation failed");
			}
			await io.writeStdout(
				`wrote ${relativeDynamicWorkflowPath(base.cwd, validation.workflowPath)}\n`,
			);
			if (bool(args, "start")) {
				const generatedSessionId = `dynamic-${basename(outDir)}-${randomUUID().slice(0, 8)}`;
				await startGeneratedWorkflow({
					cwd: base.cwd,
					workflowPath: validation.workflowPath,
					sessionId: generatedSessionId,
					...(base.plotDir === undefined ? {} : { plotDir: base.plotDir }),
					...(base.agentDir === undefined ? {} : { agentDir: base.agentDir }),
					...(base.sessionDir === undefined
						? {}
						: { sessionDir: base.sessionDir }),
				});
				await io.writeStdout(`started ${generatedSessionId}\n`);
			}
		} catch (error) {
			await writeCliStderr(io, `Error: ${errorMessage(error)}\n`);
			throw error;
		}
	},
});
