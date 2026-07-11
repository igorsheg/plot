import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { SessionWorkProvider } from "../src/components/session-work/context.js";
import { WorkDetailProvider } from "../src/components/session-work/detail-context.js";
import { SessionWork } from "../src/components/session-work/session-work.js";
import { WorkDetail } from "../src/components/session-work/work-detail.js";
import type { SessionWorkContextValue } from "../src/components/session-work/context.js";
import type { WorkDetailContextValue } from "../src/components/session-work/detail-context.js";

const noop = (): void => undefined;

const workValue: SessionWorkContextValue = {
	state: {
		nowMs: 1_000_000,
		attention: [
			{
				kind: "decision",
				key: "decision",
				workKey: "decision",
				sourceId: "source",
				title: "Needs operator",
				reason: undefined,
				actions: [
					{
						id: "approve",
						label: "Approve",
						tone: "primary",
						requiresComment: false,
					},
				],
			},
			{
				kind: "failure",
				key: "failure",
				title: "Failed work",
				line: undefined,
			},
			{ kind: "diagnostic", key: "diagnostic", text: "daemon restarted" },
		],
		motion: [
			{
				kind: "active",
				key: "active",
				title: "Running work",
				line: undefined,
				streaming: false,
				verifying: false,
			},
			{ kind: "queued", key: "queued", title: "Queued work" },
		],
		settled: [
			{
				key: "settled",
				label: "Settled",
				message: "Done",
				failed: false,
				atMs: 999_000,
			},
		],
		denseDecisions: false,
		loaded: true,
	},
	actions: {
		act: noop,
		actOnSource: noop,
		cancelSourceAction: noop,
		acting: false,
	},
};

const detailValue: WorkDetailContextValue = {
	state: {
		open: false,
		view: undefined,
		nowMs: 1_000_000,
	},
	actions: {
		open: noop,
		close: noop,
		step: noop,
		act: noop,
		acting: false,
	},
};

test("session work river keeps row anatomy stable", () => {
	const html = renderToString(
		<SessionWorkProvider value={workValue}>
			<WorkDetailProvider value={detailValue}>
				<SessionWork />
			</WorkDetailProvider>
		</SessionWorkProvider>,
	);

	expect(
		html.match(/data-density="work"[^>]*data-slot="work-item-frame"/g)?.length,
	).toBe(5);
	expect(
		html.match(/data-density="settled"[^>]*data-slot="work-item-frame"/g)
			?.length,
	).toBe(1);
	expect(html.match(/data-slot="work-item-subline"/g)?.length).toBe(5);
	expect(html).not.toContain("Approve");
});

test("work detail reserves an active prose well for streamed agent text", () => {
	const html = renderToString(
		<WorkDetailProvider
			value={{
				state: {
					open: true,
					nowMs: 1_000_000,
					view: {
						kind: "active",
						ref: { kind: "work", workKey: "active" },
						title: "Running work",
						subtitle: undefined,
						labels: [],
						url: undefined,
						stage: "working",
						check: undefined,
						metrics: {
							turn: 1,
							tokens: undefined,
							cost: undefined,
							elapsed: "1s",
						},
						events: [],
						narrative: { text: "Streaming **answer**", llm: true },
					},
				},
				actions: detailValue.actions,
			}}
		>
			<WorkDetail />
		</WorkDetailProvider>,
	);

	expect(html).toContain('data-slot="work-detail-active-prose"');
	expect(html).toContain("Streaming");
});
