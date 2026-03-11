import { Context } from "effect";
import type { PluginToolDefinition, TrackerPluginHooks } from "@plot/sdk";

export interface PluginContextShape {
	readonly skillPaths: ReadonlyArray<string>;
	readonly tools: ReadonlyArray<PluginToolDefinition>;
	readonly hooks: TrackerPluginHooks | undefined;
}

export class PluginContext extends Context.Tag("PluginContext")<
	PluginContext,
	PluginContextShape
>() {}
