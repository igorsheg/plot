import { Effect, Layer, Path } from "effect";
import {
	KeyValueStore,
	Persistence,
} from "effect/unstable/persistence";
import { BunServices } from "@effect/platform-bun";

export const PersistenceLayer = Layer.unwrap(
	Effect.gen(function* () {
		const pathService = yield* Path.Path;
		const cwd = yield* Effect.sync(() => process.cwd());
		const directory = pathService.join(cwd, ".plot", "cache");
		return Persistence.layerKvs.pipe(
			Layer.provide(KeyValueStore.layerFileSystem(directory)),
		);
	}),
).pipe(Layer.provide(BunServices.layer));
