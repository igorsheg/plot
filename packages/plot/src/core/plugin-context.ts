import { ServiceMap } from "effect";

export interface PluginContextShape {
	readonly skillPaths: ReadonlyArray<string>;
}

export class PluginContext extends ServiceMap.Service<
	PluginContext,
	PluginContextShape
>()("PluginContext") {}
