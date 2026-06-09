import { describe, expect, test } from "bun:test";
import { definePlotExtension } from "../src/extension.js";

interface PullRequest {
	readonly number: number;
	readonly title: string;
	readonly url: string;
	readonly headSha: string;
	readonly labels: readonly string[];
}

const paths = {
	cwd: "/repo",
	plotDir: "/repo/.plot",
	agentDir: "/repo/.plot/agent",
	sessionDir: "/repo/.plot/sessions",
	skillsDir: "/repo/.plot/skills",
	extensionsDir: "/repo/.plot/extensions",
	promptsDir: "/repo/.plot/prompts",
};

const workflow = {
	config: {},
	runtime: {},
	prompt: "Review eligible PRs.",
};

describe("Plot extension SDK", () => {
	test("lets plugin authors express discover and lifecycle hooks in plain TypeScript", async () => {
		const prs: PullRequest[] = [
			{
				number: 1,
				title: "already reviewed",
				url: "https://github.test/acme/web/pull/1",
				headSha: "sha-1",
				labels: ["agent-review"],
			},
			{
				number: 2,
				title: "needs review",
				url: "https://github.test/acme/web/pull/2",
				headSha: "sha-2",
				labels: ["agent-review"],
			},
			{
				number: 3,
				title: "wrong label",
				url: "https://github.test/acme/web/pull/3",
				headSha: "sha-3",
				labels: ["human-review"],
			},
		];
		const reviewed = new Set(["1:sha-1"]);
		const lifecycle: string[] = [];

		const extension = definePlotExtension({
			id: "github-pr-reviewer",
			parseConfig: (input) => input as { owner: string; repo: string },
			create: ({ config, work }) => ({
				discover: async () =>
					prs
						.filter((pr) => pr.labels.includes("agent-review"))
						.filter((pr) => !reviewed.has(`${pr.number}:${pr.headSha}`))
						.map((pr) =>
							work({
								id: `github:${config.owner}/${config.repo}:pr:${pr.number}`,
								version: pr.headSha,
								title: `Review PR #${pr.number}: ${pr.title}`,
								url: pr.url,
								context: {
									owner: config.owner,
									repo: config.repo,
									prNumber: pr.number,
									headSha: pr.headSha,
								},
							}),
						),
				started: (event) => {
					lifecycle.push(`started:${event.work.id}`);
				},
				completed: (event) => {
					lifecycle.push(`completed:${event.work.id}`);
				},
				shutdown: () => {
					lifecycle.push("shutdown");
				},
			}),
		});

		const parseConfig = extension.parseConfig;
		if (parseConfig === undefined) throw new Error("missing parser");
		const config = await parseConfig({ owner: "acme", repo: "web" });
		const runtime = await extension.create({
			config,
			paths,
			workflow,
			work: (input) => input,
		});
		const work = await runtime.discover();

		expect(work).toEqual([
			{
				id: "github:acme/web:pr:2",
				version: "sha-2",
				title: "Review PR #2: needs review",
				url: "https://github.test/acme/web/pull/2",
				context: {
					owner: "acme",
					repo: "web",
					prNumber: 2,
					headSha: "sha-2",
				},
			},
		]);

		const selected = work[0];
		if (selected === undefined) throw new Error("missing selected work");
		await runtime.started?.({ work: selected });
		await runtime.completed?.({ work: selected });
		await runtime.shutdown?.();
		expect(lifecycle).toEqual([
			"started:github:acme/web:pr:2",
			"completed:github:acme/web:pr:2",
			"shutdown",
		]);
	});
});
