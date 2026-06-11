#!/usr/bin/env bun
import {
	fauxAssistantMessage,
	registerPlotFauxProvider,
} from "@plot/session/testing/faux-agent-session";
import { processCliIo, runPlotCli } from "./cli.js";

const responseText = process.env["PLOT_FAUX_RESPONSE_TEXT"] ?? "plot faux ok";
const faux = registerPlotFauxProvider({
	responses: [fauxAssistantMessage(responseText)],
});

runPlotCli(process.argv.slice(2), processCliIo())
	.catch((error) => {
		process.stderr.write(
			`${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exitCode = 1;
	})
	.finally(() => faux.cleanup());
