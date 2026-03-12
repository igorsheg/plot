import { Context } from "effect";

export interface PluginContextShape {
	readonly skillPaths: ReadonlyArray<string>;
}

export class PluginContext extends Context.Tag("PluginContext")<
	PluginContext,
	PluginContextShape
>() {}
