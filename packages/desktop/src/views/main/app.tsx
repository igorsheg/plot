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

		const [proj, wf, provs, auth] = await Promise.all([
			rpc().request.getProject({ projectId }),
			rpc()
				.request.getProject({ projectId })
				.then(async (p) => {
					if (!p) return null;
					return rpc().request.readWorkflow({ projectPath: p.path });
				}),
			rpc().request.getProviders({}),
			rpc().request.getAuthStatus({}),
		]);

		setProject(proj);
		setWorkflow(wf);
		setProviders(provs);
		setAuthStatus(auth);
		setLoading(false);
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
			<div className="dark flex min-h-screen items-center justify-center bg-background text-foreground">
				<Spinner />
			</div>
		);
	}

	if (!project) {
		return (
			<div className="dark flex min-h-screen items-center justify-center bg-background text-muted-foreground">
				<p className="text-sm">Project not found</p>
			</div>
		);
	}

	return (
		<div className="dark flex min-h-screen flex-col bg-background text-foreground">
			<div
				className="flex h-[38px] shrink-0 items-center justify-between border-b border-border/50 px-4"
				style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
			>
				<div
					className="ml-[68px] flex items-center gap-2"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<span className="text-sm font-semibold">{project.name}</span>
					<Badge
						variant={statusVariant[project.status] ?? "outline"}
						className="text-[10px]"
					>
						{statusLabel[project.status] ?? project.status}
					</Badge>
					{project.agentCount > 0 && (
						<span className="text-[10px] text-muted-foreground">
							{project.agentCount} agent{project.agentCount !== 1 ? "s" : ""}
						</span>
					)}
				</div>
				{saved && (
					<span
						className="text-[11px] text-emerald-400"
						style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
					>
						Saved
					</span>
				)}
			</div>

			<div className="flex-1 overflow-auto">
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
			</div>
		</div>
	);
}
