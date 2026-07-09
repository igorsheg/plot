import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Text } from "./text.js";

const meta = {
	title: "Foundations/Text",
	parameters: { layout: "padded" },
} satisfies Meta;

export default meta;

function Spec({ token, children }: { token: string; children: ReactNode }) {
	return (
		<div
			style={{
				display: "flex",
				alignItems: "baseline",
				justifyContent: "space-between",
				gap: 24,
				padding: "14px 0",
				borderBottom: "1px solid var(--border)",
			}}
		>
			<div style={{ minWidth: 0 }}>{children}</div>
			<span
				style={{
					fontFamily: "var(--font-mono)",
					fontSize: 12,
					color: "var(--muted-foreground)",
					whiteSpace: "nowrap",
				}}
			>
				{token}
			</span>
		</div>
	);
}

/** Every variant of the one typographic primitive, in the real cascade. */
export const Scale: StoryObj = {
	render: () => (
		<div style={{ maxWidth: 760 }}>
			<Spec token="heading1 · 30/36 · 600">
				<Text variant="heading1">Refactor the projection store</Text>
			</Spec>
			<Spec token="heading2 · 24/32 · 600">
				<Text variant="heading2">Awaiting operator decision</Text>
			</Spec>
			<Spec token="heading3 · 18/28 · 600">
				<Text variant="heading3">Timeline</Text>
			</Spec>
			<Spec token="body · 16/24">
				<Text>Ran the suite and captured the failing assertion.</Text>
			</Spec>
			<Spec token="secondary · muted">
				<Text variant="secondary">
					Nothing in flight — the workflow decides what runs.
				</Text>
			</Spec>
			<Spec token="success">
				<Text variant="success">Settled · passed verify</Text>
			</Spec>
			<Spec token="error">
				<Text variant="error">verify step failed</Text>
			</Spec>
			<Spec token="mono">
				<Text variant="mono">wakes in 4m 20s · 1.2k tok/s</Text>
			</Spec>
			<Spec token="mono-secondary">
				<Text variant="mono-secondary">packages/session/src/host.ts</Text>
			</Spec>
			<Spec token="mono-error">
				<Text variant="mono-error">exit 1 · SIGABRT</Text>
			</Spec>
			<Spec token="label · uppercase 0.04em">
				<Text variant="label">verifying · queued · settled</Text>
			</Spec>
		</div>
	),
};
