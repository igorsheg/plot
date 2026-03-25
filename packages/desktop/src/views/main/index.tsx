import "./app.css";
import { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Electroview } from "electrobun/view";
import type {
	DesktopRPC,
	ProjectInfo,
	ParsedWorkflow,
	WorkflowFrontmatter,
} from "../../shared/types";
import { Button } from "@plot/ui/components/button";
import { ProjectList } from "./project-list";
import { WorkflowEditor } from "./workflow-editor";
import { MarkdownEditor } from "./markdown-editor";

const rpc = Electroview.defineRPC<DesktopRPC>({
	handlers: { requests: {}, messages: {} },
});

void new Electroview({ rpc });

type View = "list" | "editor";

function ErrorBanner({
	message,
	onDismiss,
}: {
	message: string;
	onDismiss: () => void;
}) {
	return (
		<div className="flex shrink-0 items-center justify-between bg-destructive px-4 py-2 text-destructive-foreground">
			<span>{message}</span>
			<button
				type="button"
				className="cursor-pointer border-none bg-transparent p-0 px-1 text-lg leading-none text-destructive-foreground"
				onClick={onDismiss}
			>
				×
			</button>
		</div>
	);
}

function App() {
	const [view, setView] = useState<View>("list");
	const [projects, setProjects] = useState<ProjectInfo[]>([]);
	const [selectedProject, setSelectedProject] = useState<string | null>(null);
	const [workflow, setWorkflow] = useState<ParsedWorkflow | null>(null);
	const [dirty, setDirty] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!error) return;
		const timer = setTimeout(() => setError(null), 5000);
		return () => clearTimeout(timer);
	}, [error]);

	const loadProjects = useCallback(async () => {
		const list = await rpc.request.listProjects({});
		setProjects(list);
	}, []);

	useEffect(() => {
		loadProjects().finally(() => setLoading(false));
	}, [loadProjects]);

	useEffect(() => {
		const onStatusUpdate = (payload: {
			projectPath: string;
			status: ProjectInfo["status"];
			error?: string;
		}) => {
			setProjects((prev) =>
				prev.map((p) =>
					p.path === payload.projectPath
						? { ...p, status: payload.status, error: payload.error }
						: p,
				),
			);
		};

		const onProcessExited = (payload: {
			projectPath: string;
			code: number | null;
		}) => {
			setProjects((prev) =>
				prev.map((p) =>
					p.path === payload.projectPath ? { ...p, status: "stopped" } : p,
				),
			);
		};

		rpc.addMessageListener("agentStatusUpdate", onStatusUpdate);
		rpc.addMessageListener("processExited", onProcessExited);
		return () => {
			rpc.removeMessageListener("agentStatusUpdate", onStatusUpdate);
			rpc.removeMessageListener("processExited", onProcessExited);
		};
	}, []);

	const handleProjectClick = async (path: string) => {
		setSelectedProject(path);
		setLoading(true);
		try {
			const wf = await rpc.request.readWorkflow({ projectPath: path });
			setWorkflow(wf);
			setDirty(false);
			setView("editor");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to read workflow");
		} finally {
			setLoading(false);
		}
	};

	const handleAddProject = async () => {
		const folder = await rpc.request.pickFolder({});
		if (!folder) return;
		try {
			const result = await rpc.request.addProject({ path: folder });
			if (result.status === "error") {
				setError(result.error ?? "Failed to add project");
				return;
			}
			await loadProjects();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to add project");
		}
	};

	const handleToggleAgent = async (path: string, running: boolean) => {
		try {
			if (running) {
				await rpc.request.stopAgent({ projectPath: path });
			} else {
				await rpc.request.startAgent({ projectPath: path });
			}
			await loadProjects();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to toggle agent");
		}
	};

	const handleWorkflowChange = (
		frontmatter: WorkflowFrontmatter,
		body: string,
	) => {
		setWorkflow({ frontmatter, body });
		setDirty(true);
	};

	const handleBodyChange = (body: string) => {
		if (!workflow) return;
		setWorkflow({ ...workflow, body });
		setDirty(true);
	};

	const handleSave = async () => {
		if (!selectedProject || !workflow) return;
		try {
			const result = await rpc.request.saveWorkflow({
				projectPath: selectedProject,
				workflow,
			});
			if (!result) {
				setError("Failed to save workflow");
				return;
			}
			setDirty(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to save workflow");
		}
	};

	const handleBack = () => {
		setView("list");
		setWorkflow(null);
		setSelectedProject(null);
		setDirty(false);
	};

	if (loading) {
		return (
			<div className="dark flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
				Loading...
			</div>
		);
	}

	const projectName =
		projects.find((p) => p.path === selectedProject)?.name ??
		selectedProject ??
		"";

	if (view === "editor" && workflow) {
		return (
			<div className="dark flex min-h-screen flex-col bg-background text-foreground">
				{error && (
					<ErrorBanner message={error} onDismiss={() => setError(null)} />
				)}
				<div
					className="flex h-[38px] shrink-0 items-center"
					style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
				>
					<div
						className="flex items-center gap-3 px-5"
						style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
					>
						<Button variant="outline" size="xs" onClick={handleBack}>
							← Projects
						</Button>
						<span className="text-[15px] font-semibold">{projectName}</span>
					</div>
				</div>
				<div className="flex-1 overflow-auto">
					<WorkflowEditor
						frontmatter={workflow.frontmatter}
						body={workflow.body}
						onChange={handleWorkflowChange}
						onSave={handleSave}
						dirty={dirty}
					/>
					<MarkdownEditor value={workflow.body} onChange={handleBodyChange} />
				</div>
			</div>
		);
	}

	return (
		<div className="dark flex min-h-screen flex-col bg-background text-foreground">
			{error && (
				<ErrorBanner message={error} onDismiss={() => setError(null)} />
			)}
			<div
				className="flex h-[38px] shrink-0 items-center"
				style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
			>
				<div
					className="px-6"
					style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
				>
					<h1 className="m-0 text-xl font-bold">Plot</h1>
				</div>
			</div>
			<div className="flex-1 overflow-auto px-6 pb-6 pt-4">
				<ProjectList
					projects={projects}
					onProjectClick={handleProjectClick}
					onAddProject={handleAddProject}
					onToggleAgent={handleToggleAgent}
				/>
			</div>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(<App />);
