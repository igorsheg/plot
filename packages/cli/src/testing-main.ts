#!/usr/bin/env bun
import { Effect } from "effect";
import { BunRuntime, BunServices } from "@effect/platform-bun";
import {
	createFauxAgentSessionHarness,
	fauxAssistantMessage,
} from "@plot/session/testing/faux-agent-session";
import { processCliIo, runPlotCli } from "./cli.js";

const responseText = process.env["PLOT_FAUX_RESPONSE_TEXT"] ?? "plot faux ok";
const harness = createFauxAgentSessionHarness({
	cwd: process.cwd(),
	responses: [fauxAssistantMessage(responseText)],
});

runPlotCli(process.argv.slice(2), {
	...processCliIo(),
	createAgentSession: harness.createAgentSession,
}).pipe(
	Effect.provide(BunServices.layer),
	Effect.ensuring(Effect.sync(() => harness.cleanup())),
	BunRuntime.runMain({ disableErrorReporting: false }),
);
