import { describe, expect, test } from "bun:test";
import { tickId } from "@plot/agent/model";
import { definePlotExtension } from "../src/extension.js";

describe("Plot extension SDK", () => {
	test("lets plugin authors define plain TypeScript async sources", async () => {
		const extension = definePlotExtension({
			id: "github-pr-reviewer",
			parseConfig: (input) => input as { repo: string },
			setup: async ({ config }) => ({
				source: {
					id: "github-pr-reviewer",
					observeTick: async () => [
						{
							type: "github.pr_seen",
							data: { repo: config.repo },
						},
					],
					selectWork: () => [
						{
							workKey: `github:${config.repo}:pr:1`,
							subject: `github:${config.repo}:pr:1`,
							templateContext: { repo: config.repo, number: 1 },
						},
					],
				},
			}),
		});

		const parseConfig = extension.parseConfig;
		if (parseConfig === undefined) throw new Error("missing parser");
		const config = await parseConfig({ repo: "web" });
		const instance = await extension.setup({
			config,
			paths: {
				cwd: "/repo",
				plotDir: "/repo/.plot",
				agentDir: "/repo/.plot/agent",
				sessionDir: "/repo/.plot/sessions",
				skillsDir: "/repo/.plot/skills",
				extensionsDir: "/repo/.plot/extensions",
				promptsDir: "/repo/.plot/prompts",
			},
			workflow: {
				config: {},
				runtime: {},
				prompt: "Review PRs.",
			},
		});

		expect(instance.source.id).toBe("github-pr-reviewer");
		await expect(
			instance.source.observeTick?.({
				sourceId: "github-pr-reviewer",
				tickId: 1,
				snapshot: {
					tickId: tickId(1),
					facts: new Map(),
					observations: [],
					completions: [],
					diagnostics: [],
					running: new Map(),
				},
			}),
		).resolves.toEqual([{ type: "github.pr_seen", data: { repo: "web" } }]);
	});
});
