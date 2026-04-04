export interface WorkpadSection {
	readonly title: string;
	readonly body: string;
	readonly itemCount: number;
}

export interface TrackerRunContext {
	readonly raw: string | null;
	readonly promptContext: string | null;
	readonly workpad: string | null;
	readonly reviewFeedback: string | null;
	readonly workpadSections: readonly WorkpadSection[];
}

export type { TrackerPluginConfig } from "../plugin/types.js";
