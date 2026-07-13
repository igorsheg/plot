import { defineCommand } from "citty";
import { startPlotWebGateway } from "@plot/gateway";
import { getCliIo } from "../cli-context.js";
import { openBrowser } from "../io.js";
import { resolvePlotCommand } from "../plot-command.js";

export const webCommand = defineCommand({
	meta: {
		name: "web",
		description: "Open the Fleet Web Console.",
	},
	args: {
		host: {
			type: "string",
			description: "Bind host. Default: 127.0.0.1.",
		},
		port: {
			type: "string",
			description: "Bind port. Default: random free port.",
		},
	},
	run: async ({ args }) => {
		const options: {
			host?: string;
			port?: number;
			openUrl: typeof openBrowser;
			cli: ReturnType<typeof resolvePlotCommand>;
		} = {
			openUrl: openBrowser,
			cli: resolvePlotCommand(),
		};
		if (typeof args.host === "string") options.host = args.host;
		if (typeof args.port === "string")
			options.port = Number.parseInt(args.port, 10);
		const gateway = await startPlotWebGateway(options);
		await getCliIo().writeStdout(`Plot Web Console: ${gateway.url}\n`);
		await new Promise<void>((resolve) => {
			const stop = () => {
				gateway.stop();
				resolve();
			};
			process.once("SIGINT", stop);
			process.once("SIGTERM", stop);
		});
	},
});
