export type CliAudience = "human" | "machine";
export type CliSurface = "frontend" | "transport" | "utility";

export interface CliCommandSemantics {
	readonly audience: CliAudience;
	readonly surface: CliSurface;
	readonly description: string;
}

export const cliSemantics = {
	root: {
		audience: "human",
		surface: "frontend",
		description: "Run coding-agent workflows.",
	},
	tui: {
		audience: "human",
		surface: "frontend",
		description: "Open the terminal dashboard for one Plot run.",
	},
	run: {
		audience: "human",
		surface: "frontend",
		description: "Run a workflow once without opening the dashboard.",
	},
	web: {
		audience: "human",
		surface: "frontend",
		description: "Open the local Plot canvas for running sessions.",
	},
	api: {
		audience: "machine",
		surface: "transport",
		description: "Serve the Plot API for external clients.",
	},
	registry: {
		audience: "machine",
		surface: "transport",
		description: "Manage the shared Plot run registry daemon.",
	},
} as const satisfies Record<string, CliCommandSemantics>;
