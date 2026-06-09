import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Stream } from "effect";
import { makeAgentSessionClientLayer } from "../src/agent-session-client.js";
import { AgentSessionClient } from "../src/agent-session-client.js";
import { makePlotCreateAgentSession } from "../src/pi-agent-session.js";
import {
	fauxAssistantMessage,
	registerPlotFauxProvider,
	writePlotFauxAgentFiles,
} from "../src/testing/faux-agent-session.js";
import { loadWorkflowFromNode } from "../src/workflow.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];
const originalApiKey = process.env["PLOT_FAUX_API_KEY"];

const makeWorkflowFile = async (dir: string) => {
	const path = join(dir, "WORKFLOW.md");
	await writeFile(
		path,
		[
			"---",
			"name: faux-session",
			"agent:",
			"  noTools: true",
			"---",
			"Say hello from the workflow body.",
			"",
		].join("\n"),
	);
	return path;
};

describe("faux agent-session harness", () => {
	afterEach(async () => {
		if (originalApiKey === undefined) delete process.env["PLOT_FAUX_API_KEY"];
		else process.env["PLOT_FAUX_API_KEY"] = originalApiKey;
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("runs Plot's pi factory with CLI-style overrides", async () => {
		delete process.env["PLOT_FAUX_API_KEY"];
		const dir = await mkdtemp(join(tmpdir(), "plot-session-faux-"));
		tempDirs.push(dir);
		const workflowPath = await makeWorkflowFile(dir);
		const faux = registerPlotFauxProvider({
			responses: [
				(context) =>
					fauxAssistantMessage(
						JSON.stringify(context).includes(
							"Say hello from the workflow body.",
						)
							? "saw workflow prompt"
							: "missing workflow prompt",
					),
			],
		});
		const paths = await writePlotFauxAgentFiles({
			cwd: dir,
			api: faux.api,
			provider: faux.provider,
			modelId: faux.modelId,
			modelName: faux.modelName,
		});
		const workflow = await Effect.runPromise(
			loadWorkflowFromNode(workflowPath),
		);
		const createAgentSession = makePlotCreateAgentSession({
			workflow,
			paths,
			overrides: {
				provider: faux.provider,
				model: faux.modelId,
				apiKey: "plot-faux-key",
				noTools: true,
			},
		});

		const events = await Effect.runPromise(
			Effect.gen(function* () {
				const client = yield* AgentSessionClient;
				const collected: unknown[] = [];
				yield* client
					.prompt({
						prompt: workflow.prompt,
						create: { cwd: paths.cwd },
					})
					.pipe(
						Stream.runForEach((event) =>
							Effect.sync(() => collected.push(event)),
						),
					);
				return collected;
			}).pipe(
				Effect.provide(makeAgentSessionClientLayer({ createAgentSession })),
				Effect.ensuring(Effect.sync(() => faux.cleanup())),
			),
		);

		expect(
			events.some(
				(event) =>
					event !== null &&
					typeof event === "object" &&
					"type" in event &&
					event.type === "agent_end",
			),
		).toBe(true);
		expect(JSON.stringify(events)).toContain("saw workflow prompt");
		expect(faux.getPendingResponseCount()).toBe(0);
	});
});
