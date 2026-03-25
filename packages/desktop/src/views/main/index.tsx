import { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { Electroview } from "electrobun/view";
import type {
	DesktopRPC,
	ProjectInfo,
	ParsedWorkflow,
	WorkflowFrontmatter,
} from "../../shared/types";
import { ProjectList } from "./project-list";
import { WorkflowEditor } from "./workflow-editor";
import { MarkdownEditor } from "./markdown-editor";

const rpc = Electroview.defineRPC<DesktopRPC>({
	handlers: { requests: {}, messages: {} },
});

// Electroview constructor sets up the websocket transport as a side effect
void new Electroview({ rpc });

type View = "list" | "editor";

function App() {
	const [view, setView] = useState<View>("list");
	const [projects, setProjects] = useState<ProjectInfo[]>([]);
	const [selectedProject, setSelectedProject] = useState<string | null>(null);
	const [workflow, setWorkflow] = useState<ParsedWorkflow | null>(null);
	const [dirty, setDirty] = useState(false);
	const [loading, setLoading] = useState(true);

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
					p.path === payload.projectPath
						? { ...p, status: "stopped" }
						: p,
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
		} finally {
			setLoading(false);
		}
	};

	const handleAddProject = async () => {
		const folder = await rpc.request.pickFolder({});
		if (!folder) return;
		await rpc.request.addProject({ path: folder });
		await loadProjects();
	};

	const handleToggleAgent = async (path: string, running: boolean) => {
		if (running) {
			await rpc.request.stopAgent({ projectPath: path });
		} else {
			await rpc.request.startAgent({ projectPath: path });
		}
		await loadProjects();
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
		await rpc.request.saveWorkflow({
			projectPath: selectedProject,
			workflow,
		});
		setDirty(false);
	};

	const handleBack = () => {
		setView("list");
		setWorkflow(null);
		setSelectedProject(null);
		setDirty(false);
	};

	if (loading) {
		return (
			<div style={styles.loading}>Loading...</div>
		);
	}

	const projectName =
		projects.find((p) => p.path === selectedProject)?.name ??
		selectedProject ??
		"";

	if (view === "editor" && workflow) {
		return (
			<div style={styles.shell}>
				<div style={styles.editorHeader}>
					<button type="button" style={styles.backButton} onClick={handleBack}>
						← Projects
					</button>
					<span style={styles.projectName}>{projectName}</span>
				</div>
				<div style={styles.editorContent}>
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
		<div style={styles.shell}>
			<div style={styles.listHeader}>
				<h1 style={styles.title}>Plot</h1>
			</div>
			<div style={styles.listContent}>
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

const styles: Record<string, React.CSSProperties> = {
	shell: {
		background: "#1a1a1a",
		color: "#e5e5e5",
		fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
		minHeight: "100vh",
		display: "flex",
		flexDirection: "column",
	},
	loading: {
		background: "#1a1a1a",
		color: "#737373",
		fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
		minHeight: "100vh",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		fontSize: 14,
	},
	listHeader: {
		padding: "20px 24px 0",
	},
	title: {
		fontSize: 20,
		fontWeight: 700,
		margin: 0,
	},
	listContent: {
		padding: "16px 24px 24px",
		flex: 1,
	},
	editorHeader: {
		display: "flex",
		alignItems: "center",
		gap: 12,
		padding: "12px 20px",
		borderBottom: "1px solid #333",
	},
	backButton: {
		background: "none",
		border: "1px solid #444",
		borderRadius: 4,
		color: "#a3a3a3",
		cursor: "pointer",
		padding: "4px 10px",
		fontSize: 13,
	},
	projectName: {
		fontSize: 15,
		fontWeight: 600,
	},
	editorContent: {
		flex: 1,
		overflow: "auto",
	},
};

createRoot(document.getElementById("root")!).render(<App />);
