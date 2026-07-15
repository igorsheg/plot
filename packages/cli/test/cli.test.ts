import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { SessionAuth } from "@plot/session/auth";
import type { SessionManagerClient } from "@plot/session-manager/manager";
import type { SessionSummary } from "@plot/session-manager/session";
import type { CliHost } from "../src/cli-host.js";
import { runPlotCli } from "../src/cli.js";
import { docNames } from "../src/docs.js";
import { VERSION } from "../src/package.js";

const session: SessionSummary = {
	id: "session-1",
	workflowKey: "/repo/WORKFLOW.md",
	workflowName: "review-acme",
	workflowPath: "/repo/WORKFLOW.md",
	workflowAliases: ["/repo/WORKFLOW.md"],
	projectPath: "/repo",
	state: "online",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	historyPath: "/repo/.plot/sessions/session-1.jsonl",
};

const fakeManager = (input?: {
	started?: boolean;
	stopped?: SessionSummary;
	failure?: Error;
	onStart?: (value: { cwd: string; workflowPath?: string }) => void;
}): SessionManagerClient =>
	({
		start: async (value) => {
			input?.onStart?.(value);
			if (input?.failure !== undefined) throw input.failure;
			return { session, started: input?.started ?? true };
		},
		find: async () => session,
		get: async () => session,
		stop: async () => input?.stopped,
		stopSession: async () => input?.stopped,
		list: async () => [session],
		events: async function* () {},
		tick: async () => {},
		startSourceAction: async () => ({
			accepted: true,
			actionRunId: "action-1",
		}),
		cancelSourceAction: async () => true,
		observe: async () => true,
	}) satisfies SessionManagerClient;

const fakeAuth: SessionAuth = {
	providers: async () => [],
	listModels: async () => [],
	status: async () => [],
	login: async () => {},
	logout: async () => {},
};

interface InvokeOptions {
	readonly manager?: SessionManagerClient;
	readonly cwd?: string;
	readonly auth?: SessionAuth;
	readonly prompts?: readonly string[];
	readonly isInteractive?: boolean;
}

const invoke = async (args: readonly string[], options: InvokeOptions = {}) => {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const tui: unknown[] = [];
	let managerCalls = 0;
	let promptIndex = 0;
	const host: CliHost = {
		cwd: options.cwd ?? "/repo",
		isInteractive: options.isInteractive ?? true,
		auth: options.auth ?? fakeAuth,
		stdout: (text) => {
			stdout.push(text);
		},
		stderr: (text) => {
			stderr.push(text);
		},
		prompt: async () => options.prompts?.[promptIndex++] ?? "",
		openBrowser: () => {},
		sessions: async () => {
			managerCalls += 1;
			return options.manager ?? fakeManager();
		},
		runTui: (input) => {
			tui.push(input);
		},
		startWebGateway: async () => ({ url: "http://plot/", stop: () => {} }),
		waitForTermination: async (stop) => stop(),
	};
	const code = await runPlotCli(args, host);
	return {
		code,
		stdout: stdout.join(""),
		stderr: stderr.join(""),
		tui,
		managerCalls,
	};
};

describe("plot CLI", () => {
	test("docs command topics match the public release manifest", async () => {
		const manifest = (await Bun.file(
			join(import.meta.dir, "../../../docs/docs.json"),
		).json()) as {
			readonly navigation: readonly {
				readonly items: readonly { readonly path: string }[];
			}[];
		};
		const names = manifest.navigation.flatMap((group) =>
			group.items.map((item) => item.path.replace(/\.md$/, "")),
		);
		expect([...docNames] as string[]).toEqual(names);
	});

	test("root help is the complete one-screen public surface", async () => {
		const result = await invoke(["--help"]);
		expect(result.code).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.managerCalls).toBe(0);
		for (const command of [
			"plot [workflow]",
			"plot start [workflow]",
			"plot stop [workflow]",
			"plot web",
			"plot check [workflow]",
			"plot docs [topic]",
			"plot auth",
			"plot models [query]",
		])
			expect(result.stdout).toContain(command);
		for (const removed of [
			"open",
			"run",
			"runs",
			"events",
			"api",
			"serve",
			"setup",
			"doctor",
			"config",
			"init",
		])
			expect(result.stdout).not.toContain(`plot ${removed}`);
		expect(result.stdout.split("\n").length).toBeLessThan(30);
	});

	test("version is pure", async () => {
		for (const flag of ["--version", "-v"]) {
			// eslint-disable-next-line no-await-in-loop -- prove both aliases independently.
			const result = await invoke([flag]);
			expect(result).toMatchObject({
				code: 0,
				stdout: `${VERSION}\n`,
				stderr: "",
				managerCalls: 0,
				tui: [],
			});
		}
	});

	test("nested help is pure and unknown help targets fail", async () => {
		const help = await invoke(["help", "auth", "login"]);
		expect(help.code).toBe(0);
		expect(help.stdout).toContain("plot auth login [provider]");
		expect(help.managerCalls).toBe(0);
		const unknown = await invoke(["help", "wat"]);
		expect(unknown.code).toBe(2);
		expect(unknown.stdout).toBe("");
		expect(unknown.stderr).toBe("Error: Unknown help target: wat\n");
		expect(unknown.managerCalls).toBe(0);
	});

	test("root starts or gets a Session and attaches the TUI", async () => {
		const result = await invoke(["WORKFLOW.md"]);
		expect(result.code).toBe(0);
		expect(result.tui).toHaveLength(1);
		expect(result.tui[0]).toEqual(expect.objectContaining({ session }));
	});

	test("-- explicitly accepts an unusual Workflow path", async () => {
		for (const args of [
			["--", "review"],
			["start", "--", "review"],
		] as const) {
			const calls: unknown[] = [];
			// eslint-disable-next-line no-await-in-loop -- prove both Workflow entrypoints.
			const result = await invoke(args, {
				manager: fakeManager({ onStart: (input) => calls.push(input) }),
			});
			expect(result.code).toBe(0);
			expect(calls).toEqual([{ cwd: "/repo", workflowPath: "review" }]);
		}
	});

	test("start reports whether it created the Session", async () => {
		expect(
			(
				await invoke(["start"], {
					manager: fakeManager({ started: true }),
				})
			).stdout,
		).toBe("Started review-acme\n");
		expect(
			(
				await invoke(["start"], {
					manager: fakeManager({ started: false }),
				})
			).stdout,
		).toBe("Already running review-acme\n");
	});

	test("stop is idempotent by Workflow", async () => {
		expect(
			(
				await invoke(["stop", "/repo/WORKFLOW.md"], {
					manager: fakeManager({ stopped: session }),
				})
			).stdout,
		).toBe("Stopped review-acme\n");
		expect((await invoke(["stop"], { manager: fakeManager() })).stdout).toBe(
			"/repo/WORKFLOW.md is not running\n",
		);
	});

	test("invalid invocations fail with one stderr diagnostic", async () => {
		for (const [args, message] of [
			[["wat"], "Unknown command: wat"],
			[["docs", "wat"], "Unknown docs topic: wat"],
			[["web", "--port", "wat"], "Invalid Web port: wat"],
			[["start", "one", "two"], "start accepts at most one argument"],
			[["--wat"], "Unknown option: --wat"],
		] as const) {
			// eslint-disable-next-line no-await-in-loop -- assert each public failure independently.
			const result = await invoke(args);
			expect(result.code).toBe(2);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe(`Error: ${message}\n`);
			expect(result.managerCalls).toBe(0);
		}
	});

	test("operational errors are rendered once", async () => {
		const result = await invoke(["start"], {
			manager: fakeManager({ failure: new Error("worker failed") }),
		});
		expect(result.code).toBe(1);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("Error: worker failed\n");
	});

	test("check failure does not touch the Session Manager", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plot-check-"));
		await writeFile(join(cwd, "WORKFLOW.md"), "Do it.\n");
		try {
			const result = await invoke(["check"], { cwd });
			expect(result.code).toBe(1);
			expect(result.stderr).toContain(
				"WORKFLOW.md requires an extension with at least one Source.",
			);
			expect(result.managerCalls).toBe(0);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("auth login selects a provider through the command", async () => {
		const logins: string[] = [];
		const auth: SessionAuth = {
			...fakeAuth,
			providers: async () => [
				{
					id: "anthropic",
					name: "Anthropic",
					usesCallbackServer: true,
					configured: false,
				},
				{
					id: "openai",
					name: "OpenAI",
					usesCallbackServer: true,
					configured: true,
				},
			],
			login: async ({ provider }) => {
				logins.push(provider);
			},
		};
		const result = await invoke(["auth", "login"], {
			auth,
			prompts: ["2"],
		});
		expect(result.code).toBe(0);
		expect(result.stdout).toBe("Logged in to openai.\n");
		expect(result.stderr).toContain("2. openai - OpenAI (configured)");
		expect(logins).toEqual(["openai"]);
	});
});
