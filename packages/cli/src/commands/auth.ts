import type { CommandModule } from "yargs";
import {
	loginWithPlotAuth,
	logoutWithPlotAuth,
	printPlotAuthStatus,
} from "../shared/auth.js";

type AuthAction = "status" | "login" | "logout";

type AuthArgs = {
	action?: AuthAction;
	provider?: string;
};

export const AuthCommand: CommandModule<{}, AuthArgs> = {
	command: "auth <action> [provider]",
	describe: "manage plot auth",
	builder: (yargs) =>
		yargs
			.positional("action", {
				type: "string",
				choices: ["status", "login", "logout"] as const,
			})
			.positional("provider", {
				type: "string",
				describe: "oauth provider id",
			}),
	handler: async (args) => {
		if (!args.action) {
			return;
		}
		switch (args.action) {
			case "status":
				printPlotAuthStatus();
				break;
			case "login":
				await loginWithPlotAuth(args.provider);
				break;
			case "logout":
				await logoutWithPlotAuth(args.provider);
				break;
		}
	},
};
