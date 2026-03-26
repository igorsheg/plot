import { Effect, Layer, PubSub, Ref, ServiceMap, Stream } from "effect";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONFIG_DIR, PROJECTS_FILE } from "../../shared/constants";
import { ProjectsError } from "./errors";

export type StoredProject = {
	readonly id: string;
	readonly path: string;
	readonly name: string;
};

function loadFromDisk(): ReadonlyArray<StoredProject> {
	if (!existsSync(PROJECTS_FILE)) return [];
	try {
		const data = JSON.parse(readFileSync(PROJECTS_FILE, "utf-8"));
		return data.projects ?? [];
	} catch {
		return [];
	}
}

export class Projects extends ServiceMap.Service<Projects>()("Projects", {
	make: Effect.gen(function* () {
		const state = yield* Ref.make<ReadonlyArray<StoredProject>>(loadFromDisk());
		const changePubSub = yield* PubSub.bounded<ReadonlyArray<StoredProject>>(16);

		const persist = Effect.gen(function* () {
			const current = yield* Ref.get(state);
			yield* Effect.sync(() => {
				mkdirSync(CONFIG_DIR, { recursive: true });
				writeFileSync(PROJECTS_FILE, JSON.stringify({ projects: current }, null, 2));
			});
			yield* PubSub.publish(changePubSub, current);
		});

		const list = Ref.get(state);

		const get = (id: string) =>
			Effect.map(list, (projects) => projects.find((p) => p.id === id) ?? null);

		const getByPath = (projectPath: string) =>
			Effect.map(list, (projects) => projects.find((p) => p.path === projectPath) ?? null);

		const add = (folderPath: string) =>
			Effect.gen(function* () {
				const existing = yield* getByPath(folderPath);
				if (existing) return existing;

				if (!existsSync(folderPath)) {
					return yield* new ProjectsError({ code: "not_found", message: `Folder does not exist: ${folderPath}` });
				}

				const entry: StoredProject = {
					id: crypto.randomUUID(),
					path: folderPath,
					name: path.basename(folderPath),
				};
				yield* Ref.update(state, (projects) => [...projects, entry]);
				yield* persist;
				return entry;
			});

		const remove = (idOrPath: string) =>
			Effect.gen(function* () {
				yield* Ref.update(state, (projects) =>
					projects.filter((p) => p.id !== idOrPath && p.path !== idOrPath),
				);
				yield* persist;
			});

		const changes = Stream.fromPubSub(changePubSub);

		return { list, get, getByPath, add, remove, changes };
	}),
}) {
	static layer = Layer.effect(this, this.make);
}
