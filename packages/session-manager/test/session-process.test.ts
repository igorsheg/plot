import { expect, test } from "bun:test";
import { AsyncQueue } from "@plot/common/async-queue";
import type {
	SessionWorkerCommand,
	SessionWorkerRecord,
} from "@plot/session/worker";
import { encodeSessionWorkerRecord } from "@plot/session/worker";
import { WorkflowBoundaryError } from "@plot/session/workflow";
import {
	createSessionChildProcess,
	SessionProcess,
	type SessionChildExit,
	type SessionChildProcess,
} from "../src/session-process.js";

interface FakeChild extends SessionChildProcess {
	readonly protocolQueue: AsyncQueue<string>;
	readonly stdoutQueue: AsyncQueue<string>;
	readonly stderrQueue: AsyncQueue<string>;
	readonly signals: NodeJS.Signals[];
	readonly respond: (record: SessionWorkerRecord) => void;
	readonly exit: (result?: SessionChildExit) => void;
}

const makeFakeChild = (input?: {
	readonly onCommand?: (
		command: SessionWorkerCommand,
		child: FakeChild,
	) => void;
	readonly onSignal?: (signal: NodeJS.Signals, child: FakeChild) => void;
}): FakeChild => {
	const protocolQueue = new AsyncQueue<string>();
	const stdoutQueue = new AsyncQueue<string>();
	const stderrQueue = new AsyncQueue<string>();
	const signals: NodeJS.Signals[] = [];
	let exited = false;
	let resolveExited!: (result: SessionChildExit) => void;
	const exitedPromise = new Promise<SessionChildExit>((resolve) => {
		resolveExited = resolve;
	});
	let result!: FakeChild;
	const exit = (value: SessionChildExit = { code: 0, signal: null }) => {
		if (exited) return;
		exited = true;
		protocolQueue.close();
		stdoutQueue.close();
		stderrQueue.close();
		resolveExited(value);
	};
	const respond = (record: SessionWorkerRecord) => {
		protocolQueue.offer(encodeSessionWorkerRecord(record), { force: true });
	};
	result = {
		pid: 42,
		protocol: protocolQueue,
		stdout: stdoutQueue,
		stderr: stderrQueue,
		protocolQueue,
		stdoutQueue,
		stderrQueue,
		signals,
		respond,
		exit,
		write: (line) => {
			input?.onCommand?.(JSON.parse(line) as SessionWorkerCommand, result);
		},
		kill: (signal) => {
			signals.push(signal);
			input?.onSignal?.(signal, result);
		},
		exited: exitedPromise,
	};
	return result;
};

const processFor = (spawned: SessionChildProcess, commandTimeoutMs = 20) =>
	new SessionProcess(spawned, {
		diagnosticLimitBytes: 128,
		commandTimeoutMs,
	});

const ready = (fake: FakeChild) => {
	fake.respond({
		kind: "ready",
		sessionId: "session-1",
		workflowName: "review",
		workflowPath: "/repo/WORKFLOW.md",
		projectPath: "/repo",
		historyPath: "/repo/session.jsonl",
	});
};

test("stdout and stderr are diagnostics, never protocol", async () => {
	const fake = makeFakeChild();
	const process = processFor(fake);
	fake.stdoutQueue.offer('{"not":"protocol"}\n', { force: true });
	fake.stderrQueue.offer("warning\u0000\n", { force: true });
	ready(fake);

	expect((await process.waitUntilReady(50)).sessionId).toBe("session-1");
	await Bun.sleep(1);
	expect(process.diagnosticTail()).toContain('[stdout] {"not":"protocol"}');
	expect(process.diagnosticTail()).toContain("[stderr] warning\n");
	expect(process.diagnosticTail()).not.toContain("\u0000");
	fake.exit();
});

test("diagnostic tails are byte-bounded without broken UTF-8", async () => {
	const fake = makeFakeChild();
	const process = processFor(fake);
	fake.stdoutQueue.offer(`${"🙂".repeat(100)}\n`, { force: true });
	ready(fake);
	await process.waitUntilReady(50);
	await Bun.sleep(1);
	expect(
		new TextEncoder().encode(process.diagnosticTail()).length,
	).toBeLessThanOrEqual(128);
	expect(process.diagnosticTail()).not.toContain("�");
	fake.exit();
});

test("worker startup errors recover their owner type", async () => {
	const fake = makeFakeChild();
	const process = processFor(fake);
	fake.respond({
		kind: "failure",
		error: {
			code: "workflow_invalid",
			message: "invalid extension",
			retryable: false,
			context: { phase: "prepare", path: "/repo/WORKFLOW.md" },
		},
	});
	await expect(process.waitUntilReady(50)).rejects.toBeInstanceOf(
		WorkflowBoundaryError,
	);
	fake.exit();
});

test("malformed protocol is fatal and tagged", async () => {
	const fake = makeFakeChild();
	const process = processFor(fake);
	fake.protocolQueue.offer('{"kind":"wat"}\n', { force: true });
	await expect(process.waitUntilReady(50)).rejects.toMatchObject({
		code: "worker_protocol_error",
		context: { phase: "record" },
	});
	expect(fake.signals).toEqual(["SIGTERM"]);
	fake.exit({ code: null, signal: "SIGTERM" });
});

test("graceful shutdown waits for exit without sending a signal", async () => {
	const fake = makeFakeChild({
		onCommand: (command, worker) => {
			worker.respond({
				kind: "result",
				id: command.id,
				ok: true,
				value: true,
			});
			if (command.action === "shutdown") queueMicrotask(() => worker.exit());
		},
	});
	const process = processFor(fake);
	ready(fake);
	await process.waitUntilReady(50);

	expect(
		await process.shutdown({ gracefulMs: 20, terminateMs: 20, killMs: 20 }),
	).toEqual({ mode: "graceful" });
	expect(fake.signals).toEqual([]);
});

test("hung shutdown escalates through TERM and KILL", async () => {
	const fake = makeFakeChild({
		onSignal: (signal, worker) => {
			if (signal === "SIGKILL") worker.exit({ code: null, signal: "SIGKILL" });
		},
	});
	const process = processFor(fake);
	ready(fake);
	await process.waitUntilReady(50);

	const first = process.shutdown({ gracefulMs: 2, terminateMs: 2, killMs: 20 });
	const second = process.shutdown({
		gracefulMs: 100,
		terminateMs: 100,
		killMs: 100,
	});
	expect(second).toBe(first);
	expect(await first).toEqual({ mode: "killed" });
	expect(fake.signals).toEqual(["SIGTERM", "SIGKILL"]);
});

test("real child fd 3 isolates protocol from authored output", async () => {
	const script = `
const fs = require("node:fs");
const protocol = fs.createWriteStream("plot-worker-protocol", { fd: 3, autoClose: false });
console.log("authored stdout");
console.error("authored stderr");
protocol.write(JSON.stringify({
  kind: "ready",
  sessionId: "real-child",
  workflowName: "real",
  workflowPath: "/repo/WORKFLOW.md",
  projectPath: "/repo",
  historyPath: "/repo/session.jsonl"
}) + "\\n");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.toString().trim().split("\\n")) {
    const command = JSON.parse(line);
    protocol.write(JSON.stringify({ kind: "result", id: command.id, ok: true, value: true }) + "\\n", () => {
      if (command.action === "shutdown") process.exit(0);
    });
  }
});
`;
	const spawned = createSessionChildProcess({
		command: process.execPath,
		args: ["-e", script],
		cwd: process.cwd(),
	});
	const sessionProcess = processFor(spawned, 100);

	expect((await sessionProcess.waitUntilReady(1_000)).sessionId).toBe(
		"real-child",
	);
	expect(
		await sessionProcess.shutdown({
			gracefulMs: 1_000,
			terminateMs: 100,
			killMs: 100,
		}),
	).toEqual({ mode: "graceful" });
	expect(sessionProcess.diagnosticTail()).toContain("[stdout] authored stdout");
	expect(sessionProcess.diagnosticTail()).toContain("[stderr] authored stderr");
});

test("command timeout and worker result errors retain tags", async () => {
	const fake = makeFakeChild();
	const process = processFor(fake, 3);
	ready(fake);
	await process.waitUntilReady(50);
	await expect(process.command("tick")).rejects.toMatchObject({
		code: "worker_command_timeout",
		context: { action: "tick", timeoutMs: 3 },
	});
	fake.exit();
});
