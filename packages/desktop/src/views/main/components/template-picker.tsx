import type { WorkflowTemplate } from "../../../shared/rpc";

const templates: Array<{
	id: WorkflowTemplate;
	title: string;
	description: string;
	icon: string;
}> = [
	{
		id: "github",
		title: "GitHub Issues",
		description: "Track work with GitHub issues and labels",
		icon: "🔀",
	},
	{
		id: "beads",
		title: "Beads",
		description: "Lightweight local issue tracking",
		icon: "📿",
	},
	{
		id: "blank",
		title: "Blank",
		description: "Start from scratch",
		icon: "📄",
	},
];

type Props = {
	onCreate: (template: WorkflowTemplate) => void;
};

export function TemplatePicker({ onCreate }: Props) {
	return (
		<div className="flex flex-col items-center justify-center gap-6 px-10 py-16">
			<div className="text-center">
				<h2 className="text-lg font-semibold">No WORKFLOW.md found</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Choose a template to get started
				</p>
			</div>
			<div className="grid w-full max-w-sm grid-cols-1 gap-3">
				{templates.map((t) => (
					<button
						key={t.id}
						type="button"
						onClick={() => onCreate(t.id)}
						className="flex items-center gap-3 rounded-lg border border-border/50 px-4 py-3 text-left transition-colors hover:bg-muted/50"
					>
						<span className="text-xl">{t.icon}</span>
						<div>
							<div className="text-sm font-medium">{t.title}</div>
							<div className="text-[11px] text-muted-foreground">
								{t.description}
							</div>
						</div>
					</button>
				))}
			</div>
		</div>
	);
}
