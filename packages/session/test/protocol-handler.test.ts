import { expect, test } from "bun:test";
import { makePlotProtocolLayer } from "../src/protocol-session.js";
import { plotProtocolVersion, type PlotClientRecord } from "../src/protocol.js";

const request = (
	command: PlotClientRecord["command"],
	params = {},
): PlotClientRecord => ({
	protocol: plotProtocolVersion,
	kind: "request",
	id: command,
	command,
	params,
});

test("protocol get_state returns metadata separately from welcome", async () => {
	const metadata = {
		workflowName: "workflow",
		workflowPath: "WORKFLOW.md",
		cwd: "/repo",
		cwdName: "repo",
		sessionDir: "/repo/.plot/sessions/default",
		eventLogPath: "/repo/.plot/sessions/default/events.jsonl",
	};
	const protocol = makePlotProtocolLayer({
		metadata,
		session: {
			id: "s1",
			workflow: {} as never,
			start: async () => {},
			tickOnce: async () => ({}) as never,
			submitObservation: async () => true,
			snapshot: async () => ({}) as never,
			interruptAgentRun: async () => true,
			pauseDispatch: async () => {},
			resumeDispatch: async () => {},
			events: async function* () {},
			lastEventSequence: async () => 0,
			shutdown: async () => true,
		},
	});

	const welcome = await protocol.welcome();
	expect("metadata" in welcome).toBe(false);
	const output = protocol.output();
	await protocol.submit(request("get_state"));
	for await (const record of output) {
		if (record.kind !== "response" || record.command !== "get_state") continue;
		expect(record).toMatchObject({
			ok: true,
			data: { sessionId: "s1", metadata },
		});
		break;
	}
	await protocol.close();
});

test("protocol owns Plot session lifecycle commands", async () => {
	const calls: string[] = [];
	const protocol = makePlotProtocolLayer({
		session: {
			id: "s1",
			workflow: {} as never,
			start: async () => {
				calls.push("start");
			},
			tickOnce: async () => ({}) as never,
			submitObservation: async () => true,
			snapshot: async () => ({}) as never,
			interruptAgentRun: async ({ runId }) => {
				calls.push(`interrupt:${runId}`);
				return true;
			},
			pauseDispatch: async () => {
				calls.push("pause");
			},
			resumeDispatch: async () => {
				calls.push("resume");
			},
			events: async function* () {},
			lastEventSequence: async () => 0,
			shutdown: async () => {
				calls.push("shutdown");
				return true;
			},
		},
	});

	await protocol.submit(request("start"));
	await protocol.submit(request("pause_dispatch"));
	await protocol.submit(request("resume_dispatch"));
	await protocol.submit(request("interrupt_agent_run", { runId: "run-1" }));
	await protocol.submit(request("shutdown"));
	await protocol.close();

	expect(calls).toEqual([
		"start",
		"pause",
		"resume",
		"interrupt:run-1",
		"shutdown",
	]);
});
