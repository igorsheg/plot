import type { CommandModule } from "yargs";
import { logoutWithPlotAuth } from "../shared/auth.js";

type LogoutArgs = {
	provider?: string;
};

export const LogoutCommand: CommandModule<{}, LogoutArgs> = {
	command: "logout [provider]",
	describe: "logout from a model provider for plot",
	builder: (yargs) =>
		yargs.positional("provider", {
			type: "string",
			describe: "oauth provider id, for example anthropic",
		}),
	handler: async (args) => {
		await logoutWithPlotAuth(args.provider);
	},
};
