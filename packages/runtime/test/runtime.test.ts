import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	defineExtension,
	defineWorkflow,
	type OperatorActionEvent,
} from "@plot/sdk";
import {
	createPlot,
	RuntimeError,
	type Session,
	type SessionObservation,
	type SessionSnapshot,
} from "../src/index.js";

const roots: string[] = [];
const plots: { dispose(): Promise<void> }[] = [];
const noop = () => {};

afterEach(async () => {
	await Promise.all(plots.splice(0).map((plot) => plot.dispose()));
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

const workflow = () =>
	defineWorkflow({
		name: "programmatic-test",
		agent: { provider: "anthropic", model: "claude-sonnet-4-6" },
		resources: { systemPrompt: "./this-is-literal-not-a-file.md" },
		extension: {
			use: defineExtension({
				id: "programmatic-test",
				create: () => ({ discover: () => [] }),
			}),
		},
		plot: { tickIntervalMs: 60_000 },
		prompt: "Review {{ work.title }}",
	});

const makePlot = async (cwd: string) => {
	const plot = await createPlot({
		cwd,
		credentials: {
			anthropic: { type: "api-key", apiKey: "test-key" },
		},
	});
	plots.push(plot);
	return plot;
};

const waitForSnapshot = async (
	observation: SessionObservation,
	predicate: (snapshot: SessionSnapshot) => boolean,
): Promise<SessionSnapshot> => {
	if (predicate(observation.getSnapshot())) return observation.getSnapshot();
	let unsubscribe = noop;
	try {
		return await Promise.race([
			new Promise<SessionSnapshot>((resolve) => {
				unsubscribe = observation.subscribe(() => {
					const snapshot = observation.getSnapshot();
					if (predicate(snapshot)) resolve(snapshot);
				});
			}),
			Bun.sleep(1_000).then(() => {
				throw new Error("observation update timed out");
			}),
		]);
	} finally {
		unsubscribe();
	}
};

const waitForTick = async (session: Session) => {
	const observation = session.observe();
	try {
		if (observation.getSnapshot().status === "idle") return;
		await Promise.race([
			new Promise<void>((resolve) => {
				const unsubscribe = observation.subscribe(() => {
					if (observation.getSnapshot().status !== "idle") return;
					unsubscribe();
					resolve();
				});
			}),
			Bun.sleep(1_000).then(() => {
				throw new Error("automatic tick timed out");
			}),
		]);
	} finally {
		observation.close();
	}
};

describe("programmatic Plot", () => {
	test("defines a frozen process-local Workflow value", () => {
		const definition = workflow();
		expect(Object.isFrozen(definition)).toBe(true);
		expect(workflow()).not.toBe(definition);
	});

	test("starts from values, ticks automatically, and writes no Plot files", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "value-runtime-"));
		roots.push(cwd);
		await mkdir(join(cwd, ".plot"));
		await writeFile(join(cwd, "WORKFLOW.md"), "not a Workflow");
		await writeFile(join(cwd, ".plot", "settings.json"), "not json");
		const before = (await readdir(cwd, { recursive: true })).toSorted();
		const plot = await makePlot(cwd);
		const session = await plot.start(workflow());

		await waitForTick(session);

		expect(session.state).toBe("online");
		expect(session.observe().getSnapshot()).toMatchObject({
			workflowName: "programmatic-test",
			status: "idle",
		});
		expect((await readdir(cwd, { recursive: true })).toSorted()).toEqual(
			before,
		);
	});

	test("coalesces starts by exact Workflow value and restarts after stop", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "value-runtime-"));
		roots.push(cwd);
		const plot = await makePlot(cwd);
		const definition = workflow();
		const [first, same] = await Promise.all([
			plot.start(definition),
			plot.start(definition),
		]);
		expect(same).toBe(first);
		const observation = first.observe();

		await first.stop();
		expect(first.state).toBe("stopped");
		expect(observation.getSnapshot().status).toBe("stopped");
		observation.close();
		const restarted = await plot.start(definition);
		expect(restarted.id).not.toBe(first.id);
	});

	test("does not fall back to environment authentication", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "value-runtime-"));
		roots.push(cwd);
		const previous = process.env["ANTHROPIC_API_KEY"];
		process.env["ANTHROPIC_API_KEY"] = "environment-key";
		const plot = await createPlot({ cwd });
		plots.push(plot);
		try {
			await expect(plot.start(workflow())).rejects.toMatchObject({
				code: "provider_not_authenticated",
				context: { provider: "anthropic" },
			});
		} finally {
			if (previous === undefined) delete process.env["ANTHROPIC_API_KEY"];
			else process.env["ANTHROPIC_API_KEY"] = previous;
		}
	});

	test("observation is stable and closing it does not stop execution", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "value-runtime-"));
		roots.push(cwd);
		const plot = await makePlot(cwd);
		const session = await plot.start(workflow());
		await waitForTick(session);
		const observation = session.observe();
		expect(observation.getSnapshot()).toBe(observation.getSnapshot());
		observation.close();
		await session.tick();
		expect(session.state).toBe("online");
	});

	test("runs and cancels Source requirement actions through public snapshots", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "value-runtime-"));
		roots.push(cwd);
		const extension = defineExtension({
			id: "programmatic-source-actions",
			create: () => ({
				requirements: [
					{
						id: "auth",
						label: "Authentication",
						check: () => ({
							status: "action-required" as const,
							message: "Connect an account",
							actions: [
								{
									id: "disabled",
									label: "Disabled",
									disabledReason: "Not available",
								},
								{
									id: "connect",
									label: "Connect",
									confirm: {
										title: "Connect account?",
										message: "A browser URL will be produced.",
									},
								},
							],
						}),
						action: async ({ signal, interaction }) => {
							await interaction.reportProgress("waiting for approval");
							await interaction.openUrl("https://example.com/connect", {
								fallbackText: "Open manually",
							});
							await new Promise<void>((resolve) => {
								if (signal.aborted) resolve();
								else
									signal.addEventListener("abort", () => resolve(), {
										once: true,
									});
							});
						},
					},
				],
				discover: () => [],
			}),
		});
		const definition = defineWorkflow({
			name: "programmatic-source-actions",
			agent: { provider: "anthropic", model: "claude-sonnet-4-6" },
			resources: { systemPrompt: "Test Source actions." },
			extension: { use: extension },
			plot: { tickIntervalMs: 60_000 },
			prompt: "No work",
		});
		const plot = await makePlot(cwd);
		const session = await plot.start(definition);
		const observation = session.observe();
		const required = await waitForSnapshot(observation, (snapshot) =>
			snapshot.sources.some((source) => source.readiness === "action-required"),
		);
		const source = required.sources[0];
		const requirement = source?.requirements[0];
		expect(requirement?.actions?.[1]?.confirm).toEqual({
			title: "Connect account?",
			message: "A browser URL will be produced.",
		});
		if (source === undefined || requirement === undefined)
			throw new Error("Source requirement was not observed");
		expect(
			await session.startSourceAction({
				sourceId: source.sourceId,
				requirementId: requirement.id,
				actionId: "disabled",
			}),
		).toEqual({ accepted: false });
		const started = await session.startSourceAction({
			sourceId: source.sourceId,
			requirementId: requirement.id,
			actionId: "connect",
		});
		expect(started.accepted).toBe(true);
		if (!started.accepted) throw new Error("Source action was not accepted");
		const running = await waitForSnapshot(
			observation,
			(snapshot) => snapshot.sources[0]?.action?.interaction !== undefined,
		);
		expect(running.sources[0]?.action).toMatchObject({
			actionRunId: started.actionRunId,
			status: "running",
			progress: "Open manually https://example.com/connect",
			interaction: {
				type: "open-url",
				url: "https://example.com/connect",
				fallbackText: "Open manually",
			},
		});
		expect(await session.cancelSourceAction(started.actionRunId)).toBe(true);
		const cancelled = await waitForSnapshot(
			observation,
			(snapshot) => snapshot.sources[0]?.action?.status === "cancelled",
		);
		expect(cancelled.sources[0]?.action?.progress).toBe("Setup cancelled");
		observation.close();
	});

	test("performs only current Work Operator actions with authoritative metadata", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "value-runtime-"));
		roots.push(cwd);
		let handled = false;
		let receive!: (event: OperatorActionEvent) => void;
		const received = new Promise<OperatorActionEvent>(
			(resolve) => (receive = resolve),
		);
		const extension = defineExtension({
			id: "programmatic-operator-actions",
			create: () => ({
				discover: () =>
					handled
						? []
						: [
								{
									id: "change-1",
									status: "blocked" as const,
									blockedReason: "Approval required",
									operatorActions: [
										{
											id: "approve",
											label: "Approve current state",
											requiresComment: true,
											confirm: { title: "Approve?" },
										},
										{
											id: "disabled",
											label: "Disabled",
											disabledReason: "Not available",
										},
									],
								},
							],
				operatorAction: (event) => {
					handled = true;
					receive(event);
				},
			}),
		});
		const definition = defineWorkflow({
			name: "programmatic-operator-actions",
			agent: { provider: "anthropic", model: "claude-sonnet-4-6" },
			resources: { systemPrompt: "Test Operator actions." },
			extension: { use: extension },
			plot: { tickIntervalMs: 60_000 },
			prompt: "No work",
		});
		const plot = await makePlot(cwd);
		const session = await plot.start(definition);
		const observation = session.observe();
		const snapshot = await waitForSnapshot(
			observation,
			(current) => current.workItems[0]?.status === "blocked",
		);
		const work = snapshot.workItems[0];
		expect(work?.actions?.[0]?.confirm).toEqual({
			title: "Approve?",
			message: undefined,
		});
		if (work === undefined) throw new Error("blocked work was not observed");
		expect(
			await session.performOperatorAction({
				sourceId: work.sourceId,
				workKey: work.workKey,
				actionId: "approve",
			}),
		).toBe(false);
		expect(
			await session.performOperatorAction({
				sourceId: work.sourceId,
				workKey: work.workKey,
				actionId: "disabled",
			}),
		).toBe(false);
		expect(
			await session.performOperatorAction({
				sourceId: work.sourceId,
				workKey: work.workKey,
				actionId: "approve",
				comment: "ship it",
			}),
		).toBe(true);
		const event = await Promise.race([
			received,
			Bun.sleep(1_000).then(() => {
				throw new Error("Operator action timed out");
			}),
		]);
		expect(event).toMatchObject({
			actionId: "approve",
			actionLabel: "Approve current state",
			comment: "ship it",
		});
		expect(Date.parse(event.timestamp)).not.toBeNaN();
		await waitForSnapshot(
			observation,
			(current) => current.workItems.length === 0,
		);
		observation.close();
	});

	test("rejects controls after stopping begins", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "value-runtime-"));
		roots.push(cwd);
		const plot = await makePlot(cwd);
		const session = await plot.start(workflow());
		const stopping = session.stop();
		await expect(session.tick()).rejects.toBeInstanceOf(RuntimeError);
		await expect(
			session.performOperatorAction({
				sourceId: "source",
				workKey: "work",
				actionId: "act",
			}),
		).rejects.toBeInstanceOf(RuntimeError);
		await expect(
			session.startSourceAction({
				sourceId: "source",
				requirementId: "requirement",
				actionId: "act",
			}),
		).rejects.toBeInstanceOf(RuntimeError);
		await stopping;
	});
});
