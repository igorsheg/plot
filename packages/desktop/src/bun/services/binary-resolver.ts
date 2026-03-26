import { Effect, Layer, Ref, ServiceMap } from "effect";
import { existsSync } from "node:fs";
import path from "node:path";

function findBinary(): string {
	const plotCli = path.resolve(import.meta.dirname, "../../../plot/src/cli/index.ts");
	if (existsSync(plotCli)) return "bun";

	const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
	const globalBin = path.join(home, ".bun", "bin", "plot-ai");
	if (existsSync(globalBin)) return globalBin;

	return "plot-ai";
}

export class BinaryResolver extends ServiceMap.Service<BinaryResolver>()("BinaryResolver", {
	make: Effect.gen(function* () {
		const cached = yield* Ref.make<string | null>(null);

		const resolve = Effect.gen(function* () {
			const existing = yield* Ref.get(cached);
			if (existing) return existing;
			const found = yield* Effect.sync(() => findBinary());
			yield* Ref.set(cached, found);
			return found;
		});

		const resolveArgs = Effect.gen(function* () {
			const plotCli = path.resolve(import.meta.dirname, "../../../plot/src/cli/index.ts");
			if (existsSync(plotCli)) {
				return ["bun", "run", plotCli] as ReadonlyArray<string>;
			}
			const bin = yield* resolve;
			return [bin] as ReadonlyArray<string>;
		});

		return { resolve, resolveArgs };
	}),
}) {
	static layer = Layer.effect(this, this.make);
}
