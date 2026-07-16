import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { BoundaryError } from "@plot/common/boundary-error";
import type { SessionAuth } from "@plot/session/auth";
import type { RuntimeEvent, SessionEvent } from "@plot/session/runtime";
import type {
	SessionManagerClient,
	StartWorkflow,
} from "@plot/session-manager/manager";
import type { SessionSummary } from "@plot/session-manager/session";
import type { CliHost } from "../src/cli-host.js";
import { runCli } from "../src/cli.js";
import { docNames } from "../src/docs.js";
import { VERSION } from "../src/package.js";
import { renderReadiness } from "../src/render.js";

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
	session?: SessionSummary;
	found?: SessionSummary | null;
	sessions?: readonly SessionSummary[];
	onStart?: (value: StartWorkflow) => void;
}): SessionManagerClient => {
	const current = input?.session ?? session;
	return {
		start: async (value) => {
			input?.onStart?.(value);
			if (input?.failure !== undefined) throw input.failure;
			return { session: current, started: input?.started ?? true };
		},
		find: async () =>
			input?.found === null ? undefined : (input?.found ?? current),
		get: async () => current,
		stop: async () => input?.stopped,
		stopSession: async () => input?.stopped,
		list: async () => input?.sessions ?? [current],
		events: async function* () {},
		tick: async () => {},
		startSourceAction: async () => ({
			accepted: true,
			actionRunId: "action-1",
		}),
		cancelSourceAction: async () => true,
		observe: async () => true,
	} satisfies SessionManagerClient;
};

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
	readonly managerAvailable?: boolean;
}

const runtimeEvent = (
	sequence: number,
	event: SessionEvent,
	timestamp = "2026-07-16T12:00:00.000Z",
): RuntimeEvent => ({
	kind: "session_event",
	sessionId: session.id,
	sequence,
	timestamp,
	event,
});

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
		existingSessions: async () => {
			managerCalls += 1;
			return options.managerAvailable === false
				? undefined
				: (options.manager ?? fakeManager());
		},
		runTui: (input) => {
			tui.push(input);
		},
		startWebGateway: async () => ({ url: "http://plot/", stop: () => {} }),
		waitForTermination: async (stop) => stop(),
	};
	const code = await runCli(args, host);
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
			"plot status [workflow]",
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
		expect(unknown.stderr).toBe(
			"Error: Unknown help target: wat\nRun: plot --help\n",
		);
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

	test("start reports lifecycle commands", async () => {
		for (const [started, heading] of [
			[true, "Started review-acme in the background."],
			[false, "Already running review-acme in the background."],
		] as const) {
			// eslint-disable-next-line no-await-in-loop -- prove both start outcomes.
			const result = await invoke(["start"], {
				manager: fakeManager({ started }),
			});
			expect(result.stdout).toContain(heading);
			expect(result.stdout).toContain("Attach: plot ");
			expect(result.stdout).toContain("Stop:   plot stop ");
			expect(result.stdout).toContain("Fleet:  plot web");
		}
	});

	test("status summarizes current work without opening a dashboard", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "cli-status-"));
		const historyPath = join(cwd, "session.jsonl");
		const events = [
			runtimeEvent(1, { type: "session_started" }),
			runtimeEvent(2, {
				type: "source_observed",
				source: {
					sourceId: "github",
					label: "GitHub",
					readiness: "action-required",
					requirements: [
						{
							id: "auth",
							label: "GitHub auth",
							status: "action-required",
							message: "Connect GitHub",
							actions: [],
						},
					],
				},
			}),
			runtimeEvent(3, {
				type: "work_observed",
				work: {
					workKey: "blocked",
					sourceId: "github",
					status: "blocked",
					reason: "Approval required",
					operatorActions: [],
				},
			}),
			runtimeEvent(4, {
				type: "work_observed",
				work: {
					workKey: "waiting",
					sourceId: "github",
					status: "waiting",
				},
			}),
			runtimeEvent(5, {
				type: "work_observed",
				work: {
					workKey: "pending",
					sourceId: "github",
					status: "pending",
				},
			}),
			runtimeEvent(6, {
				type: "attempt_started",
				run: {
					runId: "run-1",
					workKey: "active",
					sourceId: "github",
				},
			}),
			runtimeEvent(7, {
				type: "tick_completed",
				result: {
					tickId: 1,
					selected: 1,
					started: 1,
					completions: 0,
					running: 1,
					diagnostics: [],
				},
			}),
		];
		await writeFile(
			historyPath,
			`${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
		);
		const statusSession = { ...session, historyPath };
		try {
			const current = await invoke(["status"], {
				manager: fakeManager({ session: statusSession }),
			});
			expect(current.code).toBe(0);
			expect(current.stdout).toContain("review-acme  ONLINE · NEEDS YOU");
			expect(current.stdout).toContain(
				"1 active · 1 waiting · 1 pending · last tick",
			);
			expect(current.stdout).toContain("Attach: plot ");

			const all = await invoke(["status", "--all"], {
				manager: fakeManager({ session: statusSession }),
			});
			expect(all.code).toBe(0);
			expect(all.stdout).toContain("needs you (2)");
			expect(all.stdout).toContain(statusSession.workflowPath);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	test("status gives the start command when the Workflow is inactive", async () => {
		const result = await invoke(["status"], {
			managerAvailable: false,
		});
		expect(result.stdout).toContain("/repo/WORKFLOW.md is not running.");
		expect(result.stdout).toContain("Start: plot start ");
	});

	test("check output identifies the runtime and next command", () => {
		const output = renderReadiness({
			workflowPath: "/repo/WORKFLOW.md",
			workflowName: "review-acme",
			agent: { provider: "openai-codex", model: "gpt-5.5" },
			source: {
				sourceId: "github",
				label: "GitHub PRs",
				readiness: "action-required",
				requirements: [
					{
						id: "auth",
						label: "GitHub auth",
						status: "action-required",
						message: "Connect GitHub",
						actions: [],
					},
				],
			},
		});
		expect(output).toContain("OK Workflow review-acme");
		expect(output).toContain("OK Extension GitHub PRs");
		expect(output).toContain("OK Agent openai-codex/gpt-5.5");
		expect(output).toContain("Ready; setup continues in the dashboard.");
		expect(output).toContain("Run: plot ");
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

	test("invalid invocations fail with one actionable diagnostic", async () => {
		for (const [args, message] of [
			[["wat"], "Unknown command: wat"],
			[["docs", "wat"], "Unknown docs topic: wat"],
			[["web", "--port", "wat"], "Invalid Web port: wat"],
			[["start", "one", "two"], "start accepts at most one argument"],
			[
				["status", "WORKFLOW.md", "--all"],
				"status accepts either a Workflow path or --all, not both",
			],
			[["--wat"], "Unknown option: --wat"],
		] as const) {
			// eslint-disable-next-line no-await-in-loop -- assert each public failure independently.
			const result = await invoke(args);
			expect(result.code).toBe(2);
			expect(result.stdout).toBe("");
			expect(result.stderr).toBe(`Error: ${message}\nRun: plot --help\n`);
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

	test("structured errors include a repair command", async () => {
		const result = await invoke(["start"], {
			manager: fakeManager({
				failure: new BoundaryError({
					code: "provider_not_authenticated",
					message: "Provider anthropic is not authenticated.",
					retryable: false,
					context: { provider: "anthropic" },
				}),
			}),
		});
		expect(result.code).toBe(1);
		expect(result.stderr).toContain("Try: plot auth login 'anthropic'");
	});

	test("check failure does not touch the Session Manager", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "cli-check-"));
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
