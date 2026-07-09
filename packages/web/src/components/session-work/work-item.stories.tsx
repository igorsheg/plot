import type { Meta, StoryObj } from "@storybook/react-vite";
import { VStack } from "../ui/stack.js";
import { groupClass, hairlineClass } from "./styles.js";
import { WorkItem } from "./work-item.js";

const meta = {
	title: "Work/Work Item",
	parameters: { layout: "padded" },
} satisfies Meta;

export default meta;

const noop = () => {};

/**
 * The river: every row kind in salience order — attention, then motion, one
 * hairline, then settled. Built from the same atoms the app composes; the state
 * icon + line-first layout are shared across all rows.
 */
export const River: StoryObj = {
	render: () => (
		<VStack gap={20} style={{ maxWidth: 720 }}>
			<VStack as="ul" className={groupClass()}>
				<WorkItem.Root>
					<WorkItem.Frame interactive onClick={noop}>
						<WorkItem.Line>
							<WorkItem.Icon state="attention" />
							<WorkItem.Title>Approve deploy to staging?</WorkItem.Title>
							<WorkItem.Edge>2m</WorkItem.Edge>
						</WorkItem.Line>
						<WorkItem.Subline>
							Verification passed on all three checks — waiting for your
							go-ahead.
						</WorkItem.Subline>
					</WorkItem.Frame>
				</WorkItem.Root>
				<WorkItem.Root>
					<WorkItem.Frame interactive onClick={noop}>
						<WorkItem.Line>
							<WorkItem.Icon state="attention" />
							<WorkItem.Title>verify step failed</WorkItem.Title>
							<WorkItem.Edge>1m</WorkItem.Edge>
						</WorkItem.Line>
						<WorkItem.Subline tone="error">
							AssertionError: expected 200, received 500
						</WorkItem.Subline>
					</WorkItem.Frame>
				</WorkItem.Root>
				<WorkItem.Root>
					<WorkItem.Frame>
						<WorkItem.Line>
							<WorkItem.Icon state="attention" />
							<WorkItem.Title tone="error" truncate>
								worktree is dirty — 3 uncommitted files
							</WorkItem.Title>
						</WorkItem.Line>
						<WorkItem.Subline empty />
					</WorkItem.Frame>
				</WorkItem.Root>
			</VStack>

			<VStack as="ul" className={groupClass()}>
				<WorkItem.Root>
					<WorkItem.Frame interactive onClick={noop}>
						<WorkItem.Line>
							<WorkItem.Icon state="active" />
							<WorkItem.Title>Refactor the host message pump</WorkItem.Title>
							<WorkItem.Edge>20s</WorkItem.Edge>
						</WorkItem.Line>
						<WorkItem.Subline tone="secondary">
							editing packages/session/src/host.ts
						</WorkItem.Subline>
					</WorkItem.Frame>
				</WorkItem.Root>
				<WorkItem.Root>
					<WorkItem.Frame>
						<WorkItem.Line>
							<WorkItem.Icon state="queued" />
							<WorkItem.Title tone="secondary">
								Re-run the flaky integration test
							</WorkItem.Title>
							<WorkItem.Edge>wakes in 4m 20s</WorkItem.Edge>
						</WorkItem.Line>
						<WorkItem.Subline tone="secondary">
							held until the worktree settles
						</WorkItem.Subline>
					</WorkItem.Frame>
				</WorkItem.Root>
			</VStack>

			<div aria-hidden className={hairlineClass()} />

			<VStack as="ul" className={groupClass()}>
				<WorkItem.Root>
					<WorkItem.Frame density="settled" interactive onClick={noop}>
						<WorkItem.Line>
							<WorkItem.Icon state="history" />
							<WorkItem.Label>committed</WorkItem.Label>
							<WorkItem.Message>
								refine host message pump · c634736
							</WorkItem.Message>
							<WorkItem.Edge>8m</WorkItem.Edge>
						</WorkItem.Line>
					</WorkItem.Frame>
				</WorkItem.Root>
				<WorkItem.Root>
					<WorkItem.Frame density="settled" interactive onClick={noop}>
						<WorkItem.Line>
							<WorkItem.Icon state="history" />
							<WorkItem.Label>test failed</WorkItem.Label>
							<WorkItem.Message>
								<span style={{ color: "var(--destructive-foreground)" }}>
									1 assertion in host.test.ts
								</span>
							</WorkItem.Message>
							<WorkItem.Edge>20m</WorkItem.Edge>
						</WorkItem.Line>
					</WorkItem.Frame>
				</WorkItem.Root>
			</VStack>
		</VStack>
	),
};
