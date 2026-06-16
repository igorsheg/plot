import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { connectLocalControlClient } from "@plot/session/local-control-client";
import { statusLocalPlotServerDaemon } from "@plot/session/local-server-daemon";
import { startLocalPlotServer } from "@plot/session/local-server";
import { resolvePlotPaths } from "@plot/session/plot-paths";
import {
	fauxAssistantMessage,
	registerPlotFauxProvider,
	writePlotFauxAgentFiles,
	type PlotFauxProviderRegistration,
} from "@plot/session/testing/faux-agent-session";
import {
	runControlOneshot,
	runWebDashboard,
	startWebDashboard,
} from "../src/runtime.js";
import { runPlotCli } from "../src/cli.js";

const tempDirs: string[] = [];
const fauxProviders: PlotFauxProviderRegistration[] = [];

async function* chunks(values: readonly string[]) {
	for (const value of values) yield value;
}

const makeWorkflow = async (dir: string) => {
	const workflowPath = join(dir, "WORKFLOW.md");
	await writeFile(
		workflowPath,
		[
			"---",
			"name: control-entrypoint",
			"agent:",
			"  noTools: true",
			"---",
			"Say hello from the control entrypoint test.",
			"",
		].join("\n"),
	);
	return workflowPath;
};

const waitFor = async <A>(read: () => Promise<A | undefined>): Promise<A> => {
	const deadline = Date.now() + 3_000;
	while (Date.now() < deadline) {
		const value = await read();
		if (value !== undefined) return value;
		await sleep(25);
	}
	throw new Error("timed out waiting for condition");
};

describe("control-protocol product entrypoints", () => {
	afterEach(async () => {
		for (const faux of fauxProviders.splice(0)) faux.cleanup();
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("plot run opens a oneshot session in the Local Plot Server and keeps Session History", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-run-control-"));
		tempDirs.push(cwd);
		const serverDir = await mkdtemp(join(tmpdir(), "plot-run-server-"));
		tempDirs.push(serverDir);
		const workflowPath = await makeWorkflow(cwd);
		const faux = registerPlotFauxProvider({
			responses: [
				async () => {
					await sleep(200);
					return fauxAssistantMessage("done through local server");
				},
			],
		});
		fauxProviders.push(faux);
		await writePlotFauxAgentFiles({
			cwd,
			api: faux.api,
			provider: faux.provider,
			modelId: faux.modelId,
			modelName: faux.modelName,
		});
		const server = await startLocalPlotServer({ serverDir, port: 0, cwd });
		const observer = await connectLocalControlClient({
			serverDir,
			autostart: false,
		});
		try {
			const sessionId = "oneshot-entrypoint-test";
			const seenEvents: string[] = [];
			const running = runControlOneshot({
				cwd,
				workflowPath,
				sessionId,
				serverDir,
				logLevel: "none",
				logFormat: "json",
				agentSessionOverrides: {
					provider: faux.provider,
					model: faux.modelId,
					apiKey: "plot-faux-key",
					noTools: true,
				},
				onEvent: (event) => {
					seenEvents.push(event.type);
				},
			});

			const visible = await waitFor(async () => {
				const response = await observer.request("list_sessions", {});
				const sessions = (response.data as { sessions: readonly unknown[] })
					.sessions;
				return sessions.find(
					(session) =>
						typeof session === "object" &&
						session !== null &&
						(session as { id?: string }).id === sessionId,
				) as { mode?: string; state?: string } | undefined;
			});
			expect(visible.mode).toBe("oneshot");
			expect(visible.state).not.toBe("stopped");

			await running;
			expect(seenEvents).toContain("attempt_completed");
			const after = await observer.request("list_sessions", {});
			const stopped = (
				after.data as {
					sessions: readonly { id: string; state: string; mode: string }[];
				}
			).sessions.find((session) => session.id === sessionId);
			expect(stopped).toEqual(
				expect.objectContaining({ mode: "oneshot", state: "stopped" }),
			);
			const paths = resolvePlotPaths({ cwd });
			const history = await readFile(
				join(paths.sessionDir, sessionId, "history.jsonl"),
				"utf8",
			);
			expect(history).toContain('"type":"attempt_completed"');
			expect(history).toContain('"type":"session_shutdown"');
		} finally {
			observer.close();
			await server.stop();
			await sleep(50);
		}
	}, 10_000);

	test("plot web prints a fragment handoff URL without opening the browser", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-web-control-"));
		tempDirs.push(cwd);
		const serverDir = await mkdtemp(join(tmpdir(), "plot-web-server-"));
		tempDirs.push(serverDir);
		const stdout: string[] = [];
		const server = await startLocalPlotServer({
			serverDir,
			port: 0,
			cwd,
		});
		const dashboard = await startWebDashboard({
			cwd,
			sessionId: "web-test",
			serverDir,
			logLevel: "none",
			logFormat: "json",
			selectedSessionId: "existing-session",
			role: "observer",
			explicitFleet: true,
			noOpen: true,
			writeStdout: (line) => {
				stdout.push(line);
			},
			openBrowser: () => {
				throw new Error("browser should not open with --no-open");
			},
		});
		try {
			expect((await fetch(server.url)).status).toBe(404);
			expect((await fetch(dashboard.url)).status).toBe(200);
		} finally {
			await dashboard.stop();
			await server.stop();
			await sleep(50);
		}

		const output = stdout.join("");
		expect(output).toContain("░█▀█░█░░░█▀█░▀█▀");
		expect(output).toContain("Web running at: ");
		const urlText = output.match(/Web running at: (\S+)/)?.[1];
		expect(urlText).toBeDefined();
		const url = new URL(urlText!);
		expect(url.searchParams.has("token")).toBe(false);
		const hash = new URLSearchParams(url.hash.slice(1));
		expect(hash.get("session")).toBe("existing-session");
		expect(hash.get("role")).toBe("observer");
		expect(hash.get("view")).toBe("fleet");
		const ws = new URL(hash.get("ws")!);
		expect(ws.protocol).toBe("ws:");
		expect(ws.pathname).toBe("/ws");
		expect(ws.searchParams.has("token")).toBe(true);
	});

	test("plot web does not autostart an empty daemon", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-web-no-daemon-"));
		tempDirs.push(cwd);
		const serverDir = await mkdtemp(
			join(tmpdir(), "plot-web-no-daemon-server-"),
		);
		tempDirs.push(serverDir);

		await expect(
			startWebDashboard({
				cwd,
				sessionId: "web-no-daemon-test",
				serverDir,
				logLevel: "none",
				logFormat: "json",
				noOpen: true,
				writeStdout: () => undefined,
			}),
		).rejects.toThrow("Local Plot Server is not running");
		expect(await statusLocalPlotServerDaemon({ serverDir })).toBeUndefined();
	});

	test("plot web holds the CLI until stopped", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-web-hold-"));
		tempDirs.push(cwd);
		const serverDir = await mkdtemp(join(tmpdir(), "plot-web-hold-server-"));
		tempDirs.push(serverDir);
		const stdout: string[] = [];
		const server = await startLocalPlotServer({
			serverDir,
			port: 0,
			cwd,
		});
		let release!: () => void;
		const stopped = new Promise<void>((resolve) => {
			release = resolve;
		});
		let settled = false;
		const running = runWebDashboard({
			cwd,
			sessionId: "web-hold-test",
			serverDir,
			logLevel: "none",
			logFormat: "json",
			noOpen: true,
			writeStdout: (line) => {
				stdout.push(line);
			},
			waitUntilStopped: () => stopped,
		}).finally(() => {
			settled = true;
		});
		try {
			await waitFor(async () =>
				stdout.join("").includes("Web running at:") ? true : undefined,
			);
			await sleep(25);
			expect(settled).toBe(false);
			release();
			await running;
			expect(settled).toBe(true);
		} finally {
			release();
			await running.catch(() => undefined);
			await server.stop();
			await sleep(50);
		}
	});

	test("--no-server is explicit help, not the default entrypoint path", async () => {
		const stdout: string[] = [];
		await runPlotCli(["run", "--help"], {
			stdin: chunks([]),
			writeStdout: (line) => {
				stdout.push(line);
			},
		});
		const help = stdout.join("");
		expect(help).toContain("--no-server");
		expect(help).toContain("Local Plot Server");
	});
});
