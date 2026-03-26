import { useState, useEffect, useCallback } from "react";
import { electroview } from "./index";
import type {
	ProjectInfo,
	WorkflowDocument,
	WorkflowTemplate,
	ProviderInfo,
	AuthState,
} from "../../shared/rpc";
import { TemplatePicker } from "./components/template-picker";
import { WorkflowEditor } from "./components/workflow-editor";
import { Spinner } from "@plot/ui/components/spinner";
import { WindowChrome } from "./components/window-chrome";

const rpc = () => electroview.rpc!;

export function App({ projectId }: { projectId: string }) {
	const [project, setProject] = useState<ProjectInfo | null>(null);
	const [workflow, setWorkflow] = useState<WorkflowDocument | null | undefined>(
		undefined,
	);
	const [providers, setProviders] = useState<ProviderInfo[]>([]);
	const [authStatus, setAuthStatus] = useState<
		Array<{ id: string; name: string; authenticated: boolean }>
	>([]);
	const [authState, setAuthState] = useState<AuthState>({ phase: "idle" });
	const [loading, setLoading] = useState(true);

	const loadData = useCallback(async () => {
		if (!projectId) return;
		setLoading(true);

		try {
			const proj = await rpc().request.getProject({ projectId });
			setProject(proj);

			const [wf, provs, auth] = await Promise.all([
				proj
					? rpc()
							.request.readWorkflow({ projectPath: proj.path })
							.catch(() => null)
					: Promise.resolve(null),
				rpc()
					.request.getProviders({})
					.catch(() => [] as ProviderInfo[]),
				rpc()
					.request.getAuthStatus({})
					.catch(
						() =>
							[] as Array<{ id: string; name: string; authenticated: boolean }>,
					),
			]);

			setWorkflow(wf);
			setProviders(provs);
			setAuthStatus(auth);
		} catch (e) {
			console.error("loadData failed:", e);
		} finally {
			setLoading(false);
		}
	}, [projectId]);

	useEffect(() => {
		loadData();
	}, [loadData]);

	useEffect(() => {
		const handler = (e: Event) => {
			setProject((e as CustomEvent<ProjectInfo>).detail);
		};
		window.addEventListener("plot:project-updated", handler);
		return () => window.removeEventListener("plot:project-updated", handler);
	}, []);

	useEffect(() => {
		const handler = (e: Event) => {
			const state = (e as CustomEvent<AuthState>).detail;
			setAuthState(state);
			if (state.phase === "success") {
				rpc().request.getProviders({}).then(setProviders);
				rpc().request.getAuthStatus({}).then(setAuthStatus);
			}
		};
		window.addEventListener("plot:auth-state", handler);
		return () => window.removeEventListener("plot:auth-state", handler);
	}, []);

	const handleCreateWorkflow = useCallback(
		async (template: WorkflowTemplate) => {
			if (!project) return;
			const doc = await rpc().request.createWorkflow({
				projectPath: project.path,
				template,
			});
			setWorkflow(doc);
		},
		[project],
	);

	const handleSave = useCallback(
		async (doc: WorkflowDocument) => {
			if (!project) return;
			await rpc().request.saveWorkflow({
				projectPath: project.path,
				workflow: doc,
			});
		},
		[project],
	);

	const handleOpenInEditor = useCallback(async () => {
		if (!project) return;
		await rpc().request.openInEditor({ projectPath: project.path });
	}, [project]);

	if (loading) {
		return (
			<WindowChrome.Root className="desktop-ui dark flex min-h-screen flex-col bg-background">
				<WindowChrome.Titlebar className="h-[52px] px-5 gap-4">
					<WindowChrome.Controls />
				</WindowChrome.Titlebar>
				<WindowChrome.Content className="flex items-center justify-center">
					<Spinner />
				</WindowChrome.Content>
			</WindowChrome.Root>
		);
	}

	if (!project) {
		return (
			<WindowChrome.Root className="desktop-ui dark flex min-h-screen flex-col bg-background">
				<WindowChrome.Titlebar className="h-[52px] px-5 gap-4">
					<WindowChrome.Controls />
				</WindowChrome.Titlebar>
				<WindowChrome.Content className="flex items-center justify-center text-muted-foreground">
					<p className="text-sm">Project not found</p>
				</WindowChrome.Content>
			</WindowChrome.Root>
		);
	}

	return (
		<WindowChrome.Root className="desktop-ui dark flex min-h-screen flex-col bg-background">
			<WindowChrome.Titlebar className="h-[52px] px-5 gap-4">
				<WindowChrome.Controls />
				<WindowChrome.Title>{project.name}</WindowChrome.Title>
			</WindowChrome.Titlebar>
			<WindowChrome.Content>
				{workflow === null ? (
					<TemplatePicker onCreate={handleCreateWorkflow} />
				) : workflow !== undefined ? (
					<WorkflowEditor
						workflow={workflow}
						providers={providers}
						authStatus={authStatus}
						authState={authState}
						onSave={handleSave}
						onOpenInEditor={handleOpenInEditor}
						onStartAuth={(providerId) =>
							rpc().request.startAuthFlow({ providerId })
						}
						onSubmitAuthResponse={(value) =>
							rpc().request.submitAuthResponse({ value })
						}
					/>
				) : null}
			</WindowChrome.Content>
		</WindowChrome.Root>
	);
}
