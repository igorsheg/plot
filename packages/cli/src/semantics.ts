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
		description: "Open the terminal dashboard for one Plot Session.",
	},
	run: {
		audience: "human",
		surface: "frontend",
		description: "Run a workflow once without opening the dashboard.",
	},
	serve: {
		audience: "machine",
		surface: "transport",
		description: "Serve Plot session transports for external clients.",
	},
	stdio: {
		audience: "machine",
		surface: "transport",
		description:
			"Serve the Plot session protocol over newline-delimited JSON on stdio.",
	},
} as const satisfies Record<string, CliCommandSemantics>;
