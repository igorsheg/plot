import type { Meta, StoryObj } from "@storybook/react-vite";
import type { RunStatus } from "@plot/registry/record";
import { SessionHeader } from "./session-header.js";
import {
	SessionHeaderProvider,
	type SessionHeaderContextValue,
} from "./context.js";

const meta = {
	title: "Session/Header",
	parameters: { layout: "padded" },
} satisfies Meta;

export default meta;

const NOW = 1_720_000_000_000;

const base = (status: RunStatus): SessionHeaderContextValue => ({
	state: {
		place: "epic",
		title: "pr-review",
		status,
		startedAtMs: NOW - 12 * 60_000,
		lastEventAtMs: NOW - 3_000,
		nowMs: NOW,
		throughputGraph: "▇█▆█▇█▆▇",
		throughputRate: 42,
		stderrTail: undefined,
		usage: { tokens: 48_300, cost: 0.42 },
		config: {
			model: "claude-opus-4-8",
			provider: "anthropic",
			workflow: "pr-review",
			workflowPath: "examples/pr-review/workflow.ts",
			cwd: "/Users/igors/workspace/dev/personal/epic",
			skills: ["dataviz", "verify", "code-review", "deep-research"],
			tickIntervalMs: 30_000,
			maxConcurrentRuns: 8,
			maxRunDurationMs: 3_600_000,
			pid: 99113,
		},
	},
	actions: { stop: () => {}, stopping: false },
});

function header(value: SessionHeaderContextValue): StoryObj {
	return {
		render: () => (
			<div style={{ maxWidth: 720 }}>
				<SessionHeaderProvider value={value}>
					<SessionHeader />
				</SessionHeaderProvider>
			</div>
		),
	};
}

/** Running: kicker, title, Stop, and the live throughput strip. */
export const Live = header(base("online"));

/** Booting: title with a quiet word, height-matched ghost strip. */
export const Starting = header(base("starting"));

/** Failed: error word plus the stderr tail. */
export const Errored = header({
	...base("error"),
	state: {
		...base("error").state,
		stderrTail: "Error: ECONNREFUSED 127.0.0.1:4317",
	},
});

/** Past session: quiet word, no Stop, no live strip. */
export const Stopped = header(base("stopped"));
