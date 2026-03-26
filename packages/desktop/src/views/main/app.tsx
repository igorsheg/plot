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
import { Badge } from "@plot/ui/components/badge";
import { Spinner } from "@plot/ui/components/spinner";

// Note: app.tsx doesn't use Tabs directly — the WorkflowEditor handles tab UI

const rpc = () => electroview.rpc!;

const statusLabel: Record<string, string> = {
	idle: "Idle",
	launching: "Launching...",
	connecting: "Connecting...",
	streaming: "Running",
	stopping: "Stopping...",
	stopped: "Stopped",
	failed: "Error",
};

const statusVariant: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	idle: "outline",
	launching: "secondary",
	connecting: "secondary",
	streaming: "default",
	stopping: "secondary",
	stopped: "outline",
	failed: "destructive",
};

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
	const [saved, setSaved] = useState(false);

	const loadData = useCallback(async () => {
		if (!projectId) return;
		setLoading(true);

		try {
			const proj = await rpc().request.getProject({ projectId });
			setProject(proj);

			const [wf, provs, auth] = await Promise.all([
				proj
					? rpc().request.readWorkflow({ projectPath: proj.path }).catch(() => null)
					: Promise.resolve(null),
				rpc().request.getProviders({}).catch(() => [] as ProviderInfo[]),
				rpc().request.getAuthStatus({}).catch(
					() => [] as Array<{ id: string; name: string; authenticated: boolean }>,
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
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		},
		[project],
	);

	const handleOpenInEditor = useCallback(async () => {
		if (!project) return;
		await rpc().request.openInEditor({ projectPath: project.path });
	}, [project]);

	if (loading) {
		return (
			<div className="desktop-ui dark flex min-h-screen items-center justify-center bg-background">
				<Spinner />
			</div>
		);
	}

	if (!project) {
		return (
			<div className="desktop-ui dark flex min-h-screen items-center justify-center bg-background text-muted-foreground">
				<p className="text-sm">Project not found</p>
			</div>
		);
	}

	return (
		<div className="desktop-ui dark flex min-h-screen flex-col bg-background">
			{workflow === null ? (
				<>
					<div
						className="electrobun-webkit-app-region-drag titlebar flex shrink-0 items-end px-4 pb-2"
					>
						<div className="electrobun-webkit-app-region-no-drag ml-[68px] flex items-center gap-2">
							<span className="text-label font-semibold">{project.name}</span>
							<Badge
								variant={statusVariant[project.status] ?? "outline"}
								size="sm"
							>
								{statusLabel[project.status] ?? project.status}
							</Badge>
						</div>
					</div>
					<div className="flex-1 overflow-auto">
						<TemplatePicker onCreate={handleCreateWorkflow} />
					</div>
				</>
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
					projectName={project.name}
					projectStatus={project.status}
					agentCount={project.agentCount}
					saved={saved}
				/>
			) : null}
		</div>
	);
}
