import { ServiceMap } from "effect";

export interface PluginContextShape {}

export class PluginContext extends ServiceMap.Service<
	PluginContext,
	PluginContextShape
>()("PluginContext") {}
