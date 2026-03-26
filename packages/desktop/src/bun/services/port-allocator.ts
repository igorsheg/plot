import { Effect, Layer, Ref, ServiceMap } from "effect";
import { DEFAULT_PORT_START } from "../../shared/constants";

export class PortAllocator extends ServiceMap.Service<PortAllocator>()("PortAllocator", {
	make: Effect.gen(function* () {
		const allocated = yield* Ref.make(new Set<number>());

		const allocate = Ref.modify(allocated, (set) => {
			let port = DEFAULT_PORT_START;
			while (set.has(port)) port++;
			const next = new Set(set);
			next.add(port);
			return [port, next] as const;
		});

		const release = (port: number) =>
			Ref.update(allocated, (set) => {
				const next = new Set(set);
				next.delete(port);
				return next;
			});

		return { allocate, release };
	}),
}) {
	static layer = Layer.effect(this, this.make);
}
