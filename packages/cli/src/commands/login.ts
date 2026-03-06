import type { CommandModule } from "yargs";
import { loginWithPlotAuth } from "../shared/auth.js";

type LoginArgs = {
	provider?: string;
};

export const LoginCommand: CommandModule<{}, LoginArgs> = {
	command: "login [provider]",
	describe: "login to a model provider for plot",
	builder: (yargs) =>
		yargs.positional("provider", {
			type: "string",
			describe: "oauth provider id, for example anthropic",
		}),
	handler: async (args) => {
		await loginWithPlotAuth(args.provider);
	},
};
