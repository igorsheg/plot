import { Effect, Layer, ServiceMap } from "effect";
import { Utils } from "electrobun/bun";

type SpawnOpts = {
	readonly cwd?: string;
	readonly stdio?: readonly [
		"ignore" | "pipe" | "inherit",
		"ignore" | "pipe" | "inherit",
		"ignore" | "pipe" | "inherit",
	];
};

export class Platform extends ServiceMap.Service<Platform>()("Platform", {
	make: Effect.succeed({
		spawn: (args: ReadonlyArray<string>, opts?: SpawnOpts) =>
			Effect.sync(() =>
				Bun.spawn([...args], {
					cwd: opts?.cwd,
					stdio: opts?.stdio ? [...opts.stdio] : undefined,
				}),
			),

		openExternal: (url: string) => Effect.sync(() => Utils.openExternal(url)),

		openPath: (path: string) => Effect.sync(() => Utils.openPath(path)),

		showItemInFolder: (path: string) => Effect.sync(() => Utils.showItemInFolder(path)),
	}),
}) {
	static layer = Layer.effect(this, this.make);
}
