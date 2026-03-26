import { Effect, Layer, ServiceMap } from "effect";
import { Projects } from "./projects";
import { ProjectSupervisor } from "./project-supervisor";
import { AuthService } from "./auth-service";
import { WorkflowIO } from "./workflow-io";
import { Platform } from "./platform";
import type { ProjectInfo, WorkflowTemplate } from "../../shared/rpc";

export class DesktopMain extends ServiceMap.Service<DesktopMain>()("DesktopMain", {
	make: Effect.gen(function* () {
		const projects = yield* Projects;
		const supervisor = yield* ProjectSupervisor;
		const auth = yield* AuthService;
		const workflow = yield* WorkflowIO;
		const platform = yield* Platform;

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

		const readWorkflow = (projectPath: string) => workflow.read(projectPath);

		const saveWorkflow = (projectPath: string, doc: Parameters<typeof workflow.write>[1]) =>
			workflow.write(projectPath, doc);

		const createWorkflow = (projectPath: string, template: WorkflowTemplate) =>
			workflow.createFromTemplate(projectPath, template);

		const openInEditor = (projectPath: string) =>
			platform.openPath(`${projectPath}/WORKFLOW.md`);

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
			readWorkflow,
			saveWorkflow,
			createWorkflow,
			openInEditor,
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
		Layer.provide(WorkflowIO.layer),
		Layer.provide(Platform.layer),
	);
}
