import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { connectLocalControlClient } from "@plot/session/local-control-client";
import { startLocalPlotServer } from "@plot/session/local-server";
import { openAndAttachPlotTuiSession, runPlotTui } from "../src/plot-tui.js";

const tempDirs: string[] = [];

const makeWorkflow = async (dir: string) => {
	const extensionPath = join(dir, "no-work.extension.ts");
	await writeFile(
		extensionPath,
		`export default { id: "no-work", create: () => ({ discover: () => [] }) };\n`,
	);
	const workflowPath = join(dir, "WORKFLOW.md");
	await writeFile(
		workflowPath,
		[
			"---",
			"name: tui-control-test",
			"extension:",
			"  source: ./no-work.extension.ts",
			"---",
			"There is no work in this TUI test.",
			"",
		].join("\n"),
	);
	return workflowPath;
};

describe("Plot TUI", () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("exports the protocol TUI runner", () => {
		expect(typeof runPlotTui).toBe("function");
	});

	test("opens requested oneshot sessions", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-tui-oneshot-"));
		tempDirs.push(cwd);
		const serverDir = await mkdtemp(join(tmpdir(), "plot-tui-server-"));
		tempDirs.push(serverDir);
		const workflowPath = await makeWorkflow(cwd);
		const server = await startLocalPlotServer({ serverDir, port: 0, cwd });
		const observer = await connectLocalControlClient({
			serverDir,
			autostart: false,
		});
		try {
			const sessionId = "tui-oneshot-test";
			const attachment = await openAndAttachPlotTuiSession({
				cwd,
				workflowPath,
				sessionId,
				serverDir,
				mode: "oneshot",
			});
			const listed = await observer.request("list_sessions", {});
			expect(
				(
					listed.data as {
						sessions: readonly { id: string; mode: string }[];
					}
				).sessions,
			).toContainEqual(
				expect.objectContaining({ id: sessionId, mode: "oneshot" }),
			);
			await attachment.close();
			attachment.client.close();
		} finally {
			observer.close();
			await server.stop();
			await sleep(50);
		}
	});

	test("detaching the TUI keeps the server session running", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-tui-detach-"));
		tempDirs.push(cwd);
		const serverDir = await mkdtemp(join(tmpdir(), "plot-tui-server-"));
		tempDirs.push(serverDir);
		const workflowPath = await makeWorkflow(cwd);
		const server = await startLocalPlotServer({ serverDir, port: 0, cwd });
		const observer = await connectLocalControlClient({
			serverDir,
			autostart: false,
		});
		try {
			const sessionId = "tui-detach-test";
			const attachment = await openAndAttachPlotTuiSession({
				cwd,
				workflowPath,
				sessionId,
				serverDir,
			});
			await attachment.client.detachSession({ sessionId });
			attachment.client.close();
			await sleep(50);

			let listed = await observer.request("list_sessions", {});
			const live = (
				listed.data as {
					sessions: readonly { id: string; state: string }[];
				}
			).sessions.find((session) => session.id === sessionId);
			expect(live).toBeDefined();
			expect(live?.state).not.toBe("stopped");

			const cleanup = await openAndAttachPlotTuiSession({
				cwd,
				workflowPath,
				sessionId,
				serverDir,
			});
			await cleanup.close();
			cleanup.client.close();
			listed = await observer.request("list_sessions", {});
			expect(
				(
					listed.data as {
						sessions: readonly { id: string; state: string }[];
					}
				).sessions.find((session) => session.id === sessionId),
			).toEqual(expect.objectContaining({ state: "stopped" }));
		} finally {
			observer.close();
			await server.stop();
			await sleep(50);
		}
	});

	test("opens through the Local Plot Server and close stops the owned session", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-tui-control-"));
		tempDirs.push(cwd);
		const serverDir = await mkdtemp(join(tmpdir(), "plot-tui-server-"));
		tempDirs.push(serverDir);
		const workflowPath = await makeWorkflow(cwd);
		const server = await startLocalPlotServer({ serverDir, port: 0, cwd });
		const observer = await connectLocalControlClient({
			serverDir,
			autostart: false,
		});
		try {
			const sessionId = "tui-entrypoint-test";
			const attachment = await openAndAttachPlotTuiSession({
				cwd,
				workflowPath,
				sessionId,
				serverDir,
			});
			expect(attachment.projection.sessionId).toBe(sessionId);
			let listed = await observer.request("list_sessions", {});
			expect(
				(
					listed.data as {
						sessions: readonly { id: string; mode: string }[];
					}
				).sessions,
			).toContainEqual(
				expect.objectContaining({ id: sessionId, mode: "watch" }),
			);

			await attachment.close();
			listed = await observer.request("list_sessions", {});
			const stopped = (
				listed.data as {
					sessions: readonly { id: string; state: string }[];
				}
			).sessions.find((session) => session.id === sessionId);
			expect(stopped).toEqual(
				expect.objectContaining({ id: sessionId, state: "stopped" }),
			);
			attachment.client.close();

			const reopened = await openAndAttachPlotTuiSession({
				cwd,
				workflowPath,
				sessionId,
				serverDir,
			});
			expect(reopened.projection.sessionId).toBe(sessionId);
			await reopened.close();
			reopened.client.close();
		} finally {
			observer.close();
			await server.stop();
			await sleep(50);
		}
	});
});
