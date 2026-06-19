import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPlotSettings } from "../src/plot-settings.js";

const tempDirs: string[] = [];

describe("Plot settings", () => {
	afterEach(async () => {
		await Promise.all(
			tempDirs
				.splice(0)
				.map((dir) => rm(dir, { recursive: true, force: true })),
		);
	});

	test("loads agent-session defaults from Plot global and project settings", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-settings-"));
		tempDirs.push(cwd);
		const agentDir = join(cwd, "plot-home", "agent");
		await Promise.all([
			mkdir(join(cwd, "plot-home"), { recursive: true }),
			mkdir(join(cwd, ".plot"), { recursive: true }),
		]);
		await writeFile(
			join(cwd, "plot-home", "settings.json"),
			JSON.stringify({
				defaultProvider: "global-provider",
				defaultModel: "global-model",
				defaultThinkingLevel: "low",
				dynamic: { outDir: "global-workflows" },
			}),
		);
		await writeFile(
			join(cwd, ".plot", "settings.json"),
			JSON.stringify({
				defaultModel: "project-model",
				dynamic: { outDir: "project-workflows" },
			}),
		);

		const settings = await loadPlotSettings({ cwd, agentDir });

		expect(settings).toEqual({
			defaultProvider: "global-provider",
			defaultModel: "project-model",
			defaultThinkingLevel: "low",
			dynamic: { outDir: "project-workflows" },
		});
	});
});
