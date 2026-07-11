import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { PlotExtensionWorkStatus, PlotToolDefinition } from "@plot/sdk";
import { sessionProtocolMethods } from "@plot/session/protocol";
import type {
	WorkflowAgentConfig,
	WorkflowExtensionConfig,
	WorkflowPlotConfig,
	WorkflowResourcesConfig,
} from "@plot/session/workflow";
import { sessionCommandArgs } from "../src/args.js";
import { subCommands } from "../src/cli.js";
import { readPlotDoc, readSdkReference, renderDocsPaths } from "../src/docs.js";
import { getExamplesDirs } from "../src/package.js";

const plotFields = [
	"tickIntervalMs",
	"maxRunDurationMs",
	"stallTimeoutMs",
	"queueCapacity",
	"eventCapacity",
	"eventBufferCapacity",
] as const satisfies readonly (keyof WorkflowPlotConfig)[];
const agentFields = [
	"provider",
	"model",
	"thinking",
	"tools",
	"excludeTools",
	"noTools",
	"allowProjectConfig",
	"maxTurns",
] as const satisfies readonly (keyof WorkflowAgentConfig)[];
const resourceFields = [
	"skills",
	"prompts",
	"contextFiles",
	"systemPrompt",
	"appendSystemPrompt",
] as const satisfies readonly (keyof WorkflowResourcesConfig)[];
const extensionFields = [
	"source",
	"maxConcurrentRuns",
	"config",
] as const satisfies readonly (keyof WorkflowExtensionConfig)[];
const workStatuses = [
	"pending",
	"waiting",
	"blocked",
	"cancelled",
] as const satisfies readonly PlotExtensionWorkStatus[];
const toolFields = [
	"name",
	"label",
	"description",
	"promptSnippet",
	"promptGuidelines",
	"parameters",
	"executionMode",
	"execute",
] as const satisfies readonly (keyof PlotToolDefinition)[];

const plotFieldsAreExhaustive: Exclude<
	keyof WorkflowPlotConfig,
	(typeof plotFields)[number]
> extends never
	? true
	: false = true;
const agentFieldsAreExhaustive: Exclude<
	keyof WorkflowAgentConfig,
	(typeof agentFields)[number]
> extends never
	? true
	: false = true;
const resourceFieldsAreExhaustive: Exclude<
	keyof WorkflowResourcesConfig,
	(typeof resourceFields)[number]
> extends never
	? true
	: false = true;
const extensionFieldsAreExhaustive: Exclude<
	keyof WorkflowExtensionConfig,
	(typeof extensionFields)[number]
> extends never
	? true
	: false = true;
const workStatusesAreExhaustive: Exclude<
	PlotExtensionWorkStatus,
	(typeof workStatuses)[number]
> extends never
	? true
	: false = true;
const toolFieldsAreExhaustive: Exclude<
	keyof PlotToolDefinition,
	(typeof toolFields)[number]
> extends never
	? true
	: false = true;

const mentionsCode = (source: string, value: string) =>
	expect(source).toContain(`\`${value}\``);

describe("shipped documentation contracts", () => {
	test("documents every workflow field accepted by the parser", async () => {
		const docs = await readPlotDoc("workflows");
		for (const field of [
			...plotFields,
			...agentFields,
			...resourceFields,
			...extensionFields,
		])
			mentionsCode(docs, field);
		expect([
			plotFieldsAreExhaustive,
			agentFieldsAreExhaustive,
			resourceFieldsAreExhaustive,
			extensionFieldsAreExhaustive,
		]).toEqual([true, true, true, true]);
	});

	test("documents every extension work status and tool field", async () => {
		const docs = await readPlotDoc("extensions");
		for (const status of workStatuses) mentionsCode(docs, status);
		for (const field of toolFields) mentionsCode(docs, field);
		expect([workStatusesAreExhaustive, toolFieldsAreExhaustive]).toEqual([
			true,
			true,
		]);
	});

	test("documents every public session protocol method", async () => {
		const docs = await readPlotDoc("cli");
		for (const method of sessionProtocolMethods) mentionsCode(docs, method);
	});

	test("documents every CLI command", async () => {
		const docs = await readPlotDoc("cli");
		for (const name of Object.keys(subCommands))
			expect(docs).toContain(`plot ${name}`);
	});

	test("documents every session command flag", async () => {
		const docs = await readPlotDoc("cli");
		for (const key of Object.keys(sessionCommandArgs))
			expect(docs).toContain(`--${key}`);
	});

	test("documents every bundled docs topic", async () => {
		const docs = await readPlotDoc("cli");
		for (const topic of [
			"quickstart",
			"guide",
			"workflows",
			"extensions",
			"sdk",
			"tui",
			"web",
			"cli",
		])
			expect(docs).toContain(`plot docs ${topic}`);
		expect(docs).toContain("plot docs --paths");
	});

	test("ships the sdk reference the docs point at", async () => {
		const reference = await readSdkReference();
		for (const symbol of [
			"definePlotExtension",
			"defineTool",
			"DiscoveryUnavailableError",
			"PlotExtensionWork",
			"OperatorAction",
		])
			expect(reference).toContain(symbol);
		expect(renderDocsPaths()).not.toContain("(not found)");
	});

	test("every example directory named in the docs exists", async () => {
		const examplesDir = getExamplesDirs().find((dir) => existsSync(dir));
		expect(examplesDir).toBeDefined();
		const named = new Set<string>();
		const topics = ["index", "quickstart", "guide", "extensions"] as const;
		const pages = await Promise.all(topics.map((topic) => readPlotDoc(topic)));
		for (const docs of pages)
			for (const match of docs.matchAll(/`examples\/([a-z0-9-]+)\/`?/g))
				named.add(match[1]!);
		expect(named.size).toBeGreaterThan(0);
		for (const name of named)
			expect(existsSync(join(examplesDir!, name))).toBe(true);
	});

	test("documents every HTTP route exposed by the web gateway", async () => {
		const docs = await readPlotDoc("web");
		for (const route of [
			"GET /api/health",
			"GET /api/runs",
			"GET /api/runs/events",
			"POST /api/runs",
			"DELETE /api/runs/:id",
			"GET /api/runs/:id/events",
			"GET /api/runs/:id/session-events",
			"GET /api/runs/:id/projection",
			"GET /api/runs/:id/attempts/:runId/transcript",
			"POST /api/runs/:id/observations",
		])
			expect(docs).toContain(route);
	});
});
