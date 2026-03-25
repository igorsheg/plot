import type { ProjectInfo, ProjectStatus } from "../../shared/types";
import { Button } from "@plot/ui/components/button";
import { cn } from "@plot/ui/lib/utils";

const statusDotColor: Record<ProjectStatus, string> = {
	running: "bg-success",
	starting: "bg-warning",
	idle: "bg-muted-foreground",
	stopped: "bg-muted-foreground",
	error: "bg-destructive",
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
			<div className="flex w-full flex-col gap-0.5">
				<div className="flex items-center justify-center px-6 py-12 text-sm text-muted-foreground">
					No projects yet. Add a project to get started.
				</div>
				<Button variant="outline" className="w-full border-dashed" onClick={onAddProject}>
					+ Add Project
				</Button>
			</div>
		);
	}

	return (
		<div className="flex w-full flex-col gap-0.5">
			{projects.map((project) => {
				const isRunning =
					project.status === "running" || project.status === "starting";
				return (
					<div
						key={project.path}
						className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5"
						onClick={() => onProjectClick(project.path)}
					>
						<span
							className={cn("size-2 shrink-0 rounded-full", statusDotColor[project.status])}
						/>
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-semibold text-foreground">
								{project.name}
							</div>
							<div className="truncate text-xs text-muted-foreground">
								{project.path}
							</div>
						</div>
						<Button
							variant="outline"
							size="xs"
							onClick={(e: React.MouseEvent) => {
								e.stopPropagation();
								onToggleAgent(project.path, isRunning);
							}}
						>
							{isRunning ? "Stop" : "Start"}
						</Button>
					</div>
				);
			})}
			<Button variant="outline" className="mt-1 w-full border-dashed" onClick={onAddProject}>
				+ Add Project
			</Button>
		</div>
	);
}
