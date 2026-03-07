#!/usr/bin/env bun

import { Command, HelpDoc } from "@effect/cli";
import * as Span from "@effect/cli/HelpDoc/Span";
import { BunContext } from "@effect/platform-bun";
import { Effect } from "effect";
import * as ValidationError from "@effect/cli/ValidationError";
import { runServerMain } from "@plot/server";
import { runTui } from "@plot/tui";
import {
	CliError,
	createCliOutput,
	resolveRequestedOutputMode,
} from "./shared/io.js";
import { normalizeCliProcessArgv, resolveCliArgs } from "./shared/runtime.js";
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
} else if (internalCommand === "__internal-tui") {
	await runTui();
} else {
	const cli = createTuiCommand(CLI_NAME).pipe(
		Command.withSubcommands([
			ServeCommand,
			WebCommand,
			LoginCommand,
			LogoutCommand,
			AuthCommand,
		]),
		Command.run({
			name: CLI_NAME,
			version: VERSION,
			summary: Span.text("orchestrate coding agents against an issue tracker"),
			footer: HelpDoc.blocks([
				HelpDoc.h1("EXAMPLES"),
				HelpDoc.p(Span.code(CLI_NAME)),
				HelpDoc.p(Span.code(`${CLI_NAME} serve --workflow ./WORKFLOW.md`)),
				HelpDoc.p(Span.code(`${CLI_NAME} web --port 4000`)),
			]),
		}),
	);

	await cli(normalizeCliProcessArgv(process.argv)).pipe(
		Effect.provide(BunContext.layer),
		Effect.catchAll((error: unknown) => {
			if (ValidationError.isValidationError(error)) {
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
