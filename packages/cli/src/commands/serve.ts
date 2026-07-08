import { defineCommand } from "citty";
import { apiCommand } from "./api.js";
import { serveRegistryCommand } from "./registry.js";

export const serveCommand = defineCommand({
	meta: {
		name: "serve",
		description: "Serve Plot transports and background daemons.",
	},
	subCommands: {
		api: apiCommand,
		registry: serveRegistryCommand,
	},
});
