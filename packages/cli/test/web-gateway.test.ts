import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { createEventLogStore } from "@plot/session/event-log";
import {
	plotSessionRegistrationKey,
	resolvePlotSessionDiscoveryDir,
	writePlotSessionRegistration,
} from "@plot/session/session-registration";
import { startPlotWebGateway } from "../src/web-gateway.js";

describe("Plot web gateway", () => {
	test("serves live session discovery", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const agentDir = join(dir, ".plot/agent");
		const discoveryDir = resolvePlotSessionDiscoveryDir({ agentDir });
		const cwd = join(dir, "project");
		const key = plotSessionRegistrationKey({ cwd, sessionId: "default" });
		await writePlotSessionRegistration({
			discoveryDir,
			registration: {
				version: 1,
				key,
				sessionId: "default",
				workflowName: "workflow",
				workflowPath: join(cwd, "WORKFLOW.md"),
				cwd,
				cwdName: "project",
				sessionDir: join(cwd, ".plot/sessions/default"),
				eventLogPath: join(cwd, ".plot/sessions/default/events.jsonl"),
				pid: process.pid,
				startedAt: new Date().toISOString(),
				heartbeatAt: new Date().toISOString(),
				lastSequence: 3,
			},
		});

		const gateway = await startPlotWebGateway({
			cwd: dir,
			agentDir,
			open: false,
		});
		try {
			const response = await fetch(new URL("/api/sessions", gateway.url));
			const body = (await response.json()) as { readonly sessions?: unknown[] };
			expect(body.sessions).toHaveLength(1);
			expect(body.sessions?.[0]).toMatchObject({ cwd, lastSequence: 3 });
		} finally {
			gateway.stop();
		}
	});

	test("streams session events as SSE", async () => {
		const dir = await mkdtemp(join(tmpdir(), "plot-web-gateway-"));
		const agentDir = join(dir, ".plot/agent");
		const discoveryDir = resolvePlotSessionDiscoveryDir({ agentDir });
		const cwd = join(dir, "project");
		const key = plotSessionRegistrationKey({ cwd, sessionId: "default" });
		const eventLog = await createEventLogStore({
			sessionDir: join(cwd, ".plot/sessions"),
			sessionId: "default",
		});
		await eventLog.append({ type: "session_started", payload: { ok: true } });
		await writePlotSessionRegistration({
			discoveryDir,
			registration: {
				version: 1,
				key,
				sessionId: "default",
				workflowName: "workflow",
				workflowPath: join(cwd, "WORKFLOW.md"),
				cwd,
				cwdName: "project",
				sessionDir: eventLog.sessionPath,
				eventLogPath: eventLog.eventLogPath,
				pid: process.pid,
				startedAt: new Date().toISOString(),
				heartbeatAt: new Date().toISOString(),
				lastSequence: 1,
				lastEventType: "session_started",
			},
		});

		const gateway = await startPlotWebGateway({
			cwd: dir,
			agentDir,
			open: false,
		});
		const abort = new AbortController();
		try {
			const response = await fetch(
				new URL(`/api/sessions/${key}/events?after=0`, gateway.url),
				{ signal: abort.signal },
			);
			expect(response.headers.get("content-type")).toContain(
				"text/event-stream",
			);
			const reader = response.body!.getReader();
			let text = "";
			while (!text.includes("event: plot")) {
				const chunk = await reader.read();
				if (chunk.done) break;
				text += new TextDecoder().decode(chunk.value);
			}
			expect(text).toContain("id: 1");
			expect(text).toContain("session_started");
		} finally {
			abort.abort();
			gateway.stop();
		}
	});
});
