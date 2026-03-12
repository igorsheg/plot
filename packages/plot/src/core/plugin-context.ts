import { Context } from "effect";
import type { PluginToolDefinition } from "@plot/sdk";

export interface PluginContextShape {
	readonly skillPaths: ReadonlyArray<string>;
	readonly tools: ReadonlyArray<PluginToolDefinition>;
}

export class PluginContext extends Context.Tag("PluginContext")<
	PluginContext,
	PluginContextShape
>() {}
