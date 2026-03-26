import { Effect, Layer, ServiceMap } from "effect";
import { Projects } from "./projects";
import { ProjectSupervisor } from "./project-supervisor";
import { AuthService } from "./auth-service";
import type { ProjectInfo } from "../../shared/rpc";

export class DesktopMain extends ServiceMap.Service<DesktopMain>()("DesktopMain", {
	make: Effect.gen(function* () {
		const projects = yield* Projects;
		const supervisor = yield* ProjectSupervisor;
		const auth = yield* AuthService;

		const getProjectInfo = (projectId: string) =>
			Effect.gen(function* () {
				const project = yield* projects.get(projectId);
				if (!project) return null;
				const state = yield* supervisor.getState(projectId);
				return {
					...project,
					status: state.status,
					agentCount: state.agentCount,
					error: state.error,
				} satisfies ProjectInfo;
			});

		const listProjectInfos = Effect.gen(function* () {
			const all = yield* projects.list;
			return yield* Effect.all(
				all.map((p) =>
					getProjectInfo(p.id).pipe(
						Effect.map((info) => info ?? { id: p.id, path: p.path, name: p.name, status: "idle" as const, agentCount: 0 }),
					),
				),
			);
		});

		const addProject = (folderPath: string) =>
			Effect.gen(function* () {
				const stored = yield* projects.add(folderPath);
				return {
					...stored,
					status: "idle" as const,
					agentCount: 0,
				} satisfies ProjectInfo;
			});

		const removeProject = (id: string) =>
			Effect.gen(function* () {
				yield* supervisor.stop(id);
				yield* projects.remove(id);
			});

		return {
			getProjectInfo,
			listProjectInfos,
			addProject,
			removeProject,
			startProject: supervisor.start,
			stopProject: supervisor.stop,
			startAll: supervisor.startAll,
			stopAll: supervisor.stopAll,
			shutdown: supervisor.shutdown,
			getProviders: auth.getProviders,
			getAuthStatus: auth.getAuthStatus,
			startAuthLogin: auth.startLogin,
			submitAuthResponse: auth.submitResponse,
			statusStream: supervisor.statusStream,
			snapshotStream: supervisor.snapshotStream,
			authStateStream: auth.stateStream,
		};
	}),
}) {
	static layer = Layer.effect(this, this.make).pipe(
		Layer.provide(ProjectSupervisor.layer),
		Layer.provide(AuthService.layer),
		Layer.provide(Projects.layer),
	);
}
