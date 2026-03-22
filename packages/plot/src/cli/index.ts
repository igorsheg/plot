#!/usr/bin/env bun

import { Command, CliError as FrameworkCliError } from "effect/unstable/cli";
import { BunServices } from "@effect/platform-bun";
import { Effect } from "effect";
import { runServerMain } from "../server-main.js";
import { CliError, createCliOutput, resolveRequestedOutputMode } from "./shared/io.js";
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
const output = createCliOutput(resolveRequestedOutputMode(argv));
const [internalCommand] = argv;

if (internalCommand === "__internal-server") {
	await runServerMain(process.env as Record<string, string | undefined>);
	await new Promise(() => {});
} else {
	const command = createTuiCommand(CLI_NAME).pipe(
		Command.withSubcommands([ServeCommand, WebCommand, LoginCommand, LogoutCommand, AuthCommand]),
	);

	await Command.runWith(command, { version: VERSION })(argv).pipe(
		Effect.provide(BunServices.layer),
		Effect.catch((error: unknown) => {
			if (FrameworkCliError.isCliError(error)) {
				return Effect.void;
			}
			if (isCliError(error)) {
				return Effect.sync(() => {
					output.error({
						kind: error.kind,
						message: error.message,
						exitCode: error.exitCode,
					});
					process.exit(error.exitCode);
				});
			}
			return Effect.sync(() => {
				const message = error instanceof Error ? error.message : String(error);
				output.error({ kind: "runtime", message, exitCode: 1 });
				process.exit(1);
			});
		}),
		Effect.runPromise,
	);
}

function isCliError(error: unknown): error is CliError {
	return error instanceof CliError;
}
