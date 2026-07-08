import { defineCommand } from "citty";
import { serveApiCommand } from "./serve-api.js";
import { serveRegistryCommand } from "./registry.js";

export const serveCommand = defineCommand({
	meta: {
		name: "serve",
		description: "Serve Plot transports and background daemons.",
	},
	subCommands: {
		api: serveApiCommand,
		registry: serveRegistryCommand,
	},
});
