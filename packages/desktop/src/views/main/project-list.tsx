import type { ProjectInfo, ProjectStatus } from "../../shared/types";

const statusColors: Record<ProjectStatus, string> = {
	running: "#22c55e",
	starting: "#eab308",
	idle: "#737373",
	stopped: "#737373",
	error: "#ef4444",
};

const styles = {
	container: {
		display: "flex",
		flexDirection: "column" as const,
		gap: 2,
		width: "100%",
	},
	row: {
		display: "flex",
		alignItems: "center" as const,
		gap: 12,
		padding: "10px 12px",
		borderRadius: 6,
		cursor: "pointer",
		border: "1px solid #333",
		background: "#222",
	},
	dot: {
		width: 8,
		height: 8,
		borderRadius: "50%",
		flexShrink: 0,
	},
	info: {
		flex: 1,
		minWidth: 0,
	},
	name: {
		fontWeight: 600,
		fontSize: 14,
		color: "#e5e5e5",
		overflow: "hidden" as const,
		textOverflow: "ellipsis" as const,
		whiteSpace: "nowrap" as const,
	},
	path: {
		fontSize: 12,
		color: "#737373",
		overflow: "hidden" as const,
		textOverflow: "ellipsis" as const,
		whiteSpace: "nowrap" as const,
	},
	button: {
		padding: "4px 12px",
		fontSize: 12,
		borderRadius: 4,
		border: "1px solid #444",
		background: "#333",
		color: "#e5e5e5",
		cursor: "pointer",
		flexShrink: 0,
	},
	addButton: {
		padding: "10px 16px",
		fontSize: 14,
		borderRadius: 6,
		border: "1px dashed #444",
		background: "transparent",
		color: "#a3a3a3",
		cursor: "pointer",
		marginTop: 4,
		width: "100%",
	},
	empty: {
		display: "flex",
		alignItems: "center" as const,
		justifyContent: "center" as const,
		padding: "48px 24px",
		color: "#737373",
		fontSize: 14,
		textAlign: "center" as const,
	},
};

type ProjectListProps = {
	projects: ProjectInfo[];
	onProjectClick: (path: string) => void;
	onAddProject: () => void;
	onToggleAgent: (path: string, running: boolean) => void;
};

export function ProjectList({
	projects,
	onProjectClick,
	onAddProject,
	onToggleAgent,
}: ProjectListProps) {
	if (projects.length === 0) {
		return (
			<div style={styles.container}>
				<div style={styles.empty}>
					No projects yet. Add a project to get started.
				</div>
				<button type="button" style={styles.addButton} onClick={onAddProject}>
					+ Add Project
				</button>
			</div>
		);
	}

	return (
		<div style={styles.container}>
			{projects.map((project) => {
				const isRunning =
					project.status === "running" || project.status === "starting";
				return (
					<div
						key={project.path}
						style={styles.row}
						onClick={() => onProjectClick(project.path)}
					>
						<div
							style={{
								...styles.dot,
								backgroundColor: statusColors[project.status],
							}}
						/>
						<div style={styles.info}>
							<div style={styles.name}>{project.name}</div>
							<div style={styles.path}>{project.path}</div>
						</div>
						<button
							type="button"
							style={styles.button}
							onClick={(e) => {
								e.stopPropagation();
								onToggleAgent(project.path, isRunning);
							}}
						>
							{isRunning ? "Stop" : "Start"}
						</button>
					</div>
				);
			})}
			<button type="button" style={styles.addButton} onClick={onAddProject}>
				+ Add Project
			</button>
		</div>
	);
}
