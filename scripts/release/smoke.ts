#!/usr/bin/env bun

import { $ } from "bun";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { releaseDir } from "./shared.js";

const umbrellaDir = join(releaseDir, "plot-ai");
const defaultPlatformDir = join(
	releaseDir,
	process.platform === "darwin"
		? process.arch === "arm64"
			? "plot-ai-darwin-arm64"
			: "plot-ai-darwin-x64"
		: process.arch === "arm64"
			? "plot-ai-linux-arm64-gnu"
			: "plot-ai-linux-x64-gnu",
);

const platformTarball =
	process.env["PLOT_SMOKE_PLATFORM_TGZ"] ?? findTarball(defaultPlatformDir);
const umbrellaTarball =
	process.env["PLOT_SMOKE_UMBRELLA_TGZ"] ?? findTarball(umbrellaDir);

if (!existsSync(platformTarball))
	throw new Error(`missing platform tarball: ${platformTarball}`);
if (!existsSync(umbrellaTarball))
	throw new Error(`missing umbrella tarball: ${umbrellaTarball}`);

const tempDir = mkdtempSync(join(tmpdir(), "plot-smoke-"));
const homeDir = join(tempDir, "home");

try {
	writeFileSync(
		join(tempDir, "package.json"),
		JSON.stringify(
			{ name: "plot-smoke", private: true, type: "module" },
			null,
			2,
		),
	);

	await $`npm install ${platformTarball}`.cwd(tempDir);
	await $`npm install ${umbrellaTarball}`.cwd(tempDir);

	if (!existsSync(join(tempDir, "node_modules", ".bin", "plot"))) {
		throw new Error("missing plot bin after install");
	}

	if (
		existsSync(
			join(tempDir, "node_modules", "plot-ai", "examples", "debug", ".plot"),
		)
	)
		throw new Error("release includes example runtime state");
	const packageRoot = join(tempDir, "node_modules", "plot-ai");
	const platformRoot = join(
		tempDir,
		"node_modules",
		"@plot-ai",
		basename(defaultPlatformDir).replace(/^plot-ai-/, ""),
	);
	await assertPackagePayload(packageRoot);
	await assertPackagePayload(platformRoot);

	const manifest = (await Bun.file(
		join(tempDir, "node_modules", "plot-ai", "package.json"),
	).json()) as { readonly version?: string };
	const version = manifest.version;
	if (version === undefined) throw new Error("plot-ai package has no version");
	const plot = join(tempDir, "node_modules", ".bin", "plot");
	const help = runPlot(plot, ["--help"]);
	if (!help.stdout.includes(`plot v${version}`))
		throw new Error(
			`plot --help printed the wrong version; expected ${version}`,
		);
	const printedVersion = runPlot(plot, ["--version"]);
	if (printedVersion.stdout !== `${version}\n`)
		throw new Error(
			`plot --version printed ${JSON.stringify(printedVersion.stdout)}`,
		);
	const status = runPlot(plot, ["status", "--all"]);
	if (
		status.stdout !==
		"No active Workflows.\nStart one: plot start WORKFLOW.md\n"
	)
		throw new Error(`plot status printed ${JSON.stringify(status.stdout)}`);
	if (existsSync(join(homeDir, ".plot", "session-manager")))
		throw new Error("pure CLI commands created Session Manager state");
	assertUsageFailure(plot, ["wat"], "Unknown command: wat");
	assertUsageFailure(plot, ["docs", "wat"], "Unknown docs topic: wat");
	runPlot(plot, ["docs", "cli"]);
	await assertLoggingWorkerIpc(join(platformRoot, "bin", "plot"));
	await assertProgrammaticRuntime();
	await $`node --input-type=module -e ${"import { defineExtension } from 'plot-ai/sdk'; if (typeof defineExtension !== 'function') process.exit(1);"}`.cwd(
		tempDir,
	);
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}

async function assertPackagePayload(root: string): Promise<void> {
	assertSafeReleaseTree(join(root, "docs"));
	assertSafeReleaseTree(join(root, "examples"));
	const docsManifest = (await Bun.file(
		join(root, "docs", "docs.json"),
	).json()) as {
		readonly navigation: readonly {
			readonly items: readonly { readonly path: string }[];
		}[];
	};
	const expectedDocs = new Set([
		"docs.json",
		...docsManifest.navigation.flatMap((group) =>
			group.items.map((item) => item.path),
		),
	]);
	const actualDocs = new Set(readdirSync(join(root, "docs")));
	if (
		expectedDocs.size !== actualDocs.size ||
		[...expectedDocs].some((file) => !actualDocs.has(file))
	)
		throw new Error(
			`release docs do not match docs.json: ${JSON.stringify([...actualDocs])}`,
		);
}

async function assertProgrammaticRuntime(): Promise<void> {
	const cwd = join(tempDir, "programmatic");
	const programmaticHome = join(tempDir, "programmatic-home");
	mkdirSync(join(cwd, ".plot"), { recursive: true });
	writeFileSync(join(cwd, "WORKFLOW.md"), "not a valid Workflow");
	writeFileSync(join(cwd, ".plot", "settings.json"), "not json");
	const script = join(cwd, "run.mjs");
	writeFileSync(
		script,
		`import { createPlot } from "plot-ai";
import { defineExtension, defineWorkflow } from "plot-ai/sdk";

const extension = defineExtension({
  id: "release-programmatic",
  create: () => ({ discover: () => [] }),
});
const workflow = defineWorkflow({
  name: "release-programmatic",
  agent: { provider: "anthropic", model: "claude-sonnet-4-6" },
  resources: { systemPrompt: "./literal-not-a-file.md" },
  extension: { use: extension },
  plot: { tickIntervalMs: 60000 },
  prompt: "No work",
});
const plot = await createPlot({
  cwd: ${JSON.stringify(cwd)},
  credentials: { anthropic: { type: "api-key", apiKey: "release-test" } },
});
const session = await plot.start(workflow);
const observation = session.observe();
try {
  if (observation.getSnapshot().status !== "idle") {
    await Promise.race([
      new Promise((resolve) => {
        const unsubscribe = observation.subscribe(() => {
          if (observation.getSnapshot().status !== "idle") return;
          unsubscribe();
          resolve();
        });
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("automatic tick timed out")), 5000)),
    ]);
  }
  if (await session.performOperatorAction({ sourceId: "missing", workKey: "missing", actionId: "missing" }))
    throw new Error("stale Operator action was accepted");
  if ((await session.startSourceAction({ sourceId: "missing", requirementId: "missing", actionId: "missing" })).accepted)
    throw new Error("stale Source action was accepted");
  if (await session.cancelSourceAction("missing"))
    throw new Error("unknown Source action was cancelled");
} finally {
  observation.close();
  await plot.dispose();
}
`,
	);
	await $`node ${script}`.cwd(cwd).env({
		...process.env,
		HOME: programmaticHome,
	});
	if (existsSync(join(cwd, ".plot", "sessions")))
		throw new Error("programmatic runtime created Session History");
	if (existsSync(join(programmaticHome, ".plot")))
		throw new Error("programmatic runtime read or created CLI state");
}

async function assertLoggingWorkerIpc(plot: string): Promise<void> {
	const cwd = join(tempDir, "logging-worker");
	const workflowPath = join(cwd, "WORKFLOW.md");
	const extensionPath = join(cwd, "extension.ts");
	mkdirSync(cwd, { recursive: true });
	await Bun.write(
		extensionPath,
		`console.log("import output");
export default {
  id: "logging-worker",
  create: () => {
    console.log("create output");
    return {
      discover: () => {
        console.error("discover output");
        return [];
      },
    };
  },
};
`,
	);
	await Bun.write(
		workflowPath,
		`---
agent:
  provider: anthropic
  model: claude-sonnet-4-5
extension:
  source: ./extension.ts
---
Prompt
`,
	);
	const messages: Record<string, unknown>[] = [];
	let wake: (() => void) | undefined;
	const child = Bun.spawn(
		[
			plot,
			"__internal-session-worker",
			"--cwd",
			cwd,
			"--session-id",
			"release-worker",
			"--workflow",
			workflowPath,
		],
		{
			cwd,
			env: { ...process.env, HOME: homeDir, ANTHROPIC_API_KEY: "release-test" },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			serialization: "json",
			ipc: (message) => {
				messages.push(message as Record<string, unknown>);
				wake?.();
				wake = undefined;
			},
		},
	);
	const stdoutOutput = new Response(child.stdout).text();
	const stderrOutput = new Response(child.stderr).text();
	const next = async (
		predicate: (record: Record<string, unknown>) => boolean,
	): Promise<Record<string, unknown>> => {
		for (;;) {
			const record = messages.shift();
			if (record !== undefined) {
				if (record["kind"] === "failure")
					throw new Error(`packaged worker failed: ${JSON.stringify(record)}`);
				if (predicate(record)) return record;
				continue;
			}
			await Promise.race([
				new Promise<void>((resolve) => {
					wake = resolve;
				}),
				child.exited.then((code) => {
					throw new Error(`packaged worker exited before response: ${code}`);
				}),
				Bun.sleep(5_000).then(() => {
					throw new Error("packaged worker IPC timed out");
				}),
			]);
		}
	};
	await next((record) => record["kind"] === "ready");
	const command = async (id: string, action: string) => {
		child.send({ kind: "command", id, action });
		const result = await next(
			(record) => record["kind"] === "result" && record["id"] === id,
		);
		if (result["ok"] !== true)
			throw new Error(
				`packaged worker command failed: ${JSON.stringify(result)}`,
			);
	};
	await command("start", "start");
	await command("tick", "tick");
	await command("shutdown", "shutdown");
	await Promise.race([
		child.exited,
		Bun.sleep(5_000).then(() => {
			child.kill("SIGKILL");
			throw new Error("packaged worker did not exit");
		}),
	]);
	const [stdout, stderr] = await Promise.all([stdoutOutput, stderrOutput]);
	if (!stdout.includes("import output") || !stdout.includes("create output"))
		throw new Error(`packaged worker lost stdout diagnostics: ${stdout}`);
	if (!stderr.includes("discover output"))
		throw new Error(`packaged worker lost stderr diagnostics: ${stderr}`);
}

function runPlot(plot: string, args: readonly string[]) {
	const result = Bun.spawnSync({
		cmd: [plot, ...args],
		cwd: tempDir,
		env: { ...process.env, HOME: homeDir },
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		exitCode: result.exitCode,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

function assertUsageFailure(
	plot: string,
	args: readonly string[],
	message: string,
) {
	const result = runPlot(plot, args);
	if (result.exitCode !== 2)
		throw new Error(`${args.join(" ")} exited ${result.exitCode}, expected 2`);
	if (result.stdout !== "")
		throw new Error(`${args.join(" ")} unexpectedly wrote stdout`);
	if (result.stderr !== `Error: ${message}\nRun: plot --help\n`)
		throw new Error(
			`${args.join(" ")} wrote unexpected stderr: ${JSON.stringify(result.stderr)}`,
		);
}

function forbiddenReleaseName(name: string): boolean {
	const lower = name.toLowerCase();
	return (
		new Set([".plot", "node_modules", ".git", ".hg", ".svn"]).has(name) ||
		lower === ".env" ||
		lower.startsWith(".env.") ||
		lower === ".dev.vars" ||
		lower.startsWith(".dev.vars.") ||
		[".pem", ".key", ".p12", ".pfx", ".crt", ".cer", ".swp", ".swo"].some(
			(suffix) => lower.endsWith(suffix),
		)
	);
}

function assertSafeReleaseTree(root: string): void {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		const stat = lstatSync(path);
		if (stat.isSymbolicLink())
			throw new Error(`release includes symlink: ${path}`);
		if (forbiddenReleaseName(entry.name))
			throw new Error(`release includes forbidden path: ${path}`);
		if (stat.isDirectory()) assertSafeReleaseTree(path);
		else if (!stat.isFile())
			throw new Error(`release includes non-regular entry: ${path}`);
	}
}

function findTarball(dir: string) {
	const file = readdirSync(dir).find((entry) => entry.endsWith(".tgz"));
	if (!file) throw new Error(`no tarball found in ${dir}`);
	return join(dir, file);
}
