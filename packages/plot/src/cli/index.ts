#!/usr/bin/env bun

import { Command, CliError as FrameworkCliError } from "effect/unstable/cli";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { runServerMain } from "../server-main.js";
import { CliError } from "./shared/io.js";
import { emitError, emitResult } from "./shared/envelope.js";
import { ModelsCommand } from "./commands/models.js";
import { resolveCliArgs } from "./shared/runtime.js";
import { createTuiCommand } from "./commands/tui.js";
import { ServeCommand } from "./commands/serve.js";
import { WebCommand } from "./commands/web.js";
import { LoginCommand } from "./commands/login.js";
import { LogoutCommand } from "./commands/logout.js";
import { AuthCommand } from "./commands/auth.js";

const VERSION = process.env["PLOT_VERSION"] ?? "0.0.1";
const CLI_NAME = process.env["PLOT_CLI_NAME"] ?? "plot-ai";
const argv = resolveCliArgs(process.argv);
const [internalCommand] = argv;

const SUBCOMMANDS = [
	{ name: "serve", description: "start the plot orchestrator server (headless)", usage: `${CLI_NAME} serve [--port <port>] [--workflow <path>]` },
	{ name: "web", description: "start server and serve the web dashboard", usage: `${CLI_NAME} web [--port <port>] [--workflow <path>]` },
	{ name: "auth", description: "manage authentication (status, login, logout)", usage: `${CLI_NAME} auth <status|login|logout> [provider]` },
	{ name: "models", description: "list available providers and models", usage: `${CLI_NAME} models` },
	{ name: "login", description: "authenticate with a model provider (interactive)", usage: `${CLI_NAME} login [provider]` },
	{ name: "logout", description: "revoke credentials for a model provider", usage: `${CLI_NAME} logout [provider]` },
];

if (internalCommand === "__internal-server") {
	await runServerMain(process.env as Record<string, string | undefined>);
	await new Promise(() => {});
} else if (argv.length === 0 && !process.stdout.isTTY) {
	emitResult(CLI_NAME, {
		name: CLI_NAME,
		version: VERSION,
		description: "AI-powered coding agent orchestrator",
		commands: SUBCOMMANDS,
	}, [
		{ command: `${CLI_NAME} auth status`, description: "check authentication status" },
		{ command: `${CLI_NAME} models`, description: "list available providers and models" },
		{ command: `${CLI_NAME} serve`, description: "start the orchestrator server" },
	]);
} else {
	const command = createTuiCommand(CLI_NAME).pipe(
		Command.withSubcommands([ServeCommand, WebCommand, LoginCommand, LogoutCommand, AuthCommand, ModelsCommand]),
	);

	await Command.runWith(command, { version: VERSION })(argv).pipe(
		Effect.provide(BunServices.layer),
		Effect.catch((error: unknown) => {
			if (FrameworkCliError.isCliError(error)) {
				return Effect.void;
			}
			if (isCliError(error)) {
				return Effect.sync(() => {
					emitError(
						CLI_NAME,
						{ message: error.message, code: error.kind, retryable: false },
						`check ${CLI_NAME} --help`,
						[{ command: `${CLI_NAME} --help`, description: "show usage" }],
					);
					process.exit(error.exitCode);
				});
			}
			return Effect.sync(() => {
				const message = error instanceof Error ? error.message : String(error);
				emitError(
					CLI_NAME,
					{ message, code: "runtime", retryable: false },
					`run ${CLI_NAME} with --verbose for diagnostics`,
					[{ command: `${CLI_NAME} --help`, description: "show usage" }],
				);
				process.exit(1);
			});
		}),
		Effect.runPromise,
	);
}

function isCliError(error: unknown): error is CliError {
	return error instanceof CliError;
}
