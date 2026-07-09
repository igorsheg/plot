import type { Meta, StoryObj } from "@storybook/react-vite";
import { type CSSProperties, useEffect } from "react";
import { SessionWorkProvider } from "./context.js";
import type { SessionWorkContextValue } from "./context.js";
import { WorkDetailProvider } from "./detail-context.js";
import type { WorkDetailContextValue } from "./detail-context.js";
import type { DetailView } from "./detail-view-model.js";
import { SessionWork } from "./session-work.js";
import { WorkDetail } from "./work-detail.js";

const SANS_FONTS = [
	"Barlow",
	"Inter",
	"Geist",
	"Figtree",
	"Hanken Grotesk",
	"IBM Plex Sans",
	"Public Sans",
	"Instrument Sans",
] as const;

const MONO_FONTS = [
	"Geist Pixel",
	"Geist Mono",
	"JetBrains Mono",
	"IBM Plex Mono",
	"Fira Code",
	"Roboto Mono",
	"Source Code Pro",
] as const;

/**
 * Font lab: the river beside an opened work detail, with live sans/mono
 * switching. Pick families in the Controls panel — the choice loads from Google
 * Fonts (fonttrio-style) and overrides `--font-sans` / `--font-mono` on a
 * wrapper, so every `font-sans`/`font-heading`/`font-mono` in the real
 * components re-renders in the new face. `--mono-size-adjust` normalises the
 * mono's x-height to the sans (different monos want different values).
 */
const meta = {
	title: "Session/Font Lab",
	parameters: { layout: "fullscreen" },
	args: {
		sansFont: "Barlow",
		monoFont: "Geist Pixel",
		monoSizeAdjust: 0.5,
	},
	argTypes: {
		sansFont: { name: "Sans", control: "select", options: SANS_FONTS },
		monoFont: { name: "Mono", control: "select", options: MONO_FONTS },
		monoSizeAdjust: {
			name: "Mono x-height",
			control: { type: "range", min: 0.3, max: 0.85, step: 0.01 },
			description: "font-size-adjust — match the mono's x-height to the sans",
		},
	},
} satisfies Meta<FontArgs>;

export default meta;

interface FontArgs {
	readonly sansFont: string;
	readonly monoFont: string;
	readonly monoSizeAdjust: number;
}

type Story = StoryObj<FontArgs>;

// --- font loading (fonttrio-style live switch) ----------------------------

// Loaded by the app's style.css already; the rest we inject on demand.
const PRELOADED = new Set(["Geist Pixel"]);

const googleHref = (family: string): string =>
	`https://fonts.googleapis.com/css2?family=${family.replace(
		/ /g,
		"+",
	)}:wght@400;500;600;700&display=swap`;

/** Inject a Google-Fonts stylesheet for `family` once; keep it cached. */
function useGoogleFont(family: string): void {
	useEffect(() => {
		if (PRELOADED.has(family)) return;
		const id = `fontlab:${family}`;
		if (document.getElementById(id) !== null) return;
		const link = document.createElement("link");
		link.id = id;
		link.rel = "stylesheet";
		link.href = googleHref(family);
		document.head.append(link);
	}, [family]);
}

const sansStack = (family: string): string =>
	`"${family}", ui-sans-serif, system-ui, sans-serif`;

const monoStack = (family: string): string =>
	`"${family}", ui-monospace, SFMono-Regular, Menlo, Monaco, monospace`;

// --- fixtures: a populated river + an opened decision detail ---------------

const NOW = 1_720_000_000_000;
const noop = (): void => undefined;

const workValue: SessionWorkContextValue = {
	state: {
		nowMs: NOW,
		attention: [
			{
				kind: "decision",
				key: "a",
				workKey: "a",
				sourceId: "s1",
				title: "Approve deploy to staging?",
				sinceMs: NOW - 120_000,
				reason: "Verification passed on all three checks.",
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
				key: "f",
				title: "verify step failed",
				sinceMs: NOW - 60_000,
				line: "AssertionError: expected 200, received 500",
			},
		],
		motion: [
			{
				kind: "active",
				key: "b",
				title: "Refactor the host message pump",
				sinceMs: NOW - 24_000,
				line: { text: "editing packages/session/src/host.ts", llm: false },
				streaming: true,
				verifying: false,
			},
			{ kind: "queued", key: "q", title: "migrate token store", sub: "epic" },
		],
		settled: [
			{
				key: "s",
				label: "committed refine host message pump",
				message: "6 files changed, tests green.",
				failed: false,
				atMs: NOW - 480_000,
				durationMs: 64_000,
			},
		],
		denseDecisions: false,
		loaded: true,
	},
	actions: { act: noop, acting: false },
};

const detailView: DetailView = {
	kind: "decision",
	ref: { kind: "work", workKey: "a" },
	title: "Approve deploy to staging?",
	subtitle: "vercel/next.js #402",
	labels: ["deploy", "p1"],
	url: "https://github.com/vercel/next.js/pull/402",
	stage: "blocked",
	check: "passed",
	metrics: { turn: 5, tokens: 48_300, cost: 0.42, elapsed: "2m" },
	events: [
		{ kind: "read", text: "PR #402 description", atMs: NOW - 200_000 },
		{ kind: "read", text: "the diff — 12 files", atMs: NOW - 180_000 },
		{ kind: "test", text: "lint · type · unit", atMs: NOW - 120_000 },
		{ kind: "test", text: "all checks passed", atMs: NOW - 110_000 },
		{ kind: "wait", text: "awaiting operator", atMs: NOW - 100_000 },
	],
	reason:
		"Verification passed on all three checks — lint, type-check, and the full unit suite (42 tests). The build is reproducible and the diff touches only the message-pump module. Approve to promote to staging, or reject to hold and let the workflow retry.",
	decision: {
		sourceId: "s1",
		workKey: "a",
		actions: [
			{
				id: "approve",
				label: "Approve",
				tone: "primary",
				requiresComment: false,
			},
			{
				id: "reject",
				label: "Reject",
				tone: "danger",
				requiresComment: false,
				confirmTitle: "Confirm reject",
			},
		],
	},
};

const detailValue: WorkDetailContextValue = {
	state: { open: true, view: detailView, nowMs: NOW },
	actions: { open: noop, close: noop, step: noop, act: noop, acting: false },
};

// --- lab ------------------------------------------------------------------

function Specimen({ args }: { readonly args: FontArgs }) {
	return (
		<div className="flex items-baseline gap-8 border-border border-b px-8 py-4">
			<span className="font-sans text-lg text-foreground">
				Aa Sans — {args.sansFont}
			</span>
			<span className="font-mono text-muted-foreground text-sm">
				Aa Mono 0123 — {args.monoFont}
			</span>
		</div>
	);
}

function FontLab({ args }: { readonly args: FontArgs }) {
	useGoogleFont(args.sansFont);
	useGoogleFont(args.monoFont);
	const style = {
		"--font-sans": sansStack(args.sansFont),
		"--font-heading": sansStack(args.sansFont),
		"--font-mono": monoStack(args.monoFont),
		"--mono-size-adjust": String(args.monoSizeAdjust),
	} as CSSProperties;
	return (
		// font-sans on the wrapper re-resolves --font-sans here, so copy that only
		// *inherits* the sans (Text's body/secondary variants set no font-family)
		// picks up the override too — not just the explicit font-heading/mono text.
		<div
			className="flex h-dvh flex-col bg-background font-sans text-foreground"
			style={style}
		>
			<Specimen args={args} />
			<SessionWorkProvider value={workValue}>
				<WorkDetailProvider value={detailValue}>
					<div className="flex min-h-0 flex-1 overflow-hidden">
						<main className="min-w-0 flex-1 overflow-y-auto px-10 py-8">
							<div style={{ maxWidth: 560, marginInline: "auto" }}>
								<SessionWork />
							</div>
						</main>
						<aside
							className="shrink-0 border-border border-l"
							style={{ width: 440 }}
						>
							<WorkDetail />
						</aside>
					</div>
				</WorkDetailProvider>
			</SessionWorkProvider>
		</div>
	);
}

/** River + opened detail. Switch Sans / Mono in Controls to test faces live. */
export const Compare: Story = {
	render: (args) => <FontLab args={args} />,
};
