import {
	use,
	useState,
	useEffect,
	useCallback,
	useMemo,
	useRef,
	type ReactNode,
	type CSSProperties,
} from "react";
import type { WorkflowConfig } from "../../../../shared/rpc";
import { AppContext } from "../../context/app-context";
import { rpc } from "../../context/rpc";
import { Spinner } from "@plot/ui/components/spinner";
import { WindowChrome } from "../window-chrome";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarInset,
} from "@plot/ui/components/sidebar";
import {
	Settings as SettingsIcon,
	Bot,
	Wrench,
	ExternalLink,
} from "lucide-react";
import Avatar from "boring-avatars";
import {
	SettingsContext,
	useSettings,
	type SettingsContextValue,
	type SettingsSection,
} from "./context";
import {
	TrackerSection,
	AgentSection,
	AgentLimitsSection,
	WorkspaceSection,
} from "./sections";

// ── Navigation ───────────────────────────────────────

const SIDEBAR_STYLE = { "--sidebar-width": "14rem" } as CSSProperties;

const NAV_ITEMS = [
	{ title: "Workflow", icon: SettingsIcon, section: "workflow" as const },
	{ title: "Agent", icon: Bot, section: "agent" as const },
	{ title: "Advanced", icon: Wrench, section: "advanced" as const },
];

// ── Provider ─────────────────────────────────────────

function SettingsProvider({
	_projectId,
	children,
}: {
	projectId: string;
	children: ReactNode;
}) {
	const { state: appState } = use(AppContext)!;
	const project = appState.project;

	const [config, setConfig] = useState<WorkflowConfig>({});
	const [promptBody, setPromptBody] = useState("");
	const [loading, setLoading] = useState(true);
	const [section, setSection] = useState<SettingsSection>("workflow");

	const promptBodyRef = useRef(promptBody);
	const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

	useEffect(() => {
		promptBodyRef.current = promptBody;
	}, [promptBody]);

	const projectPath = project?.path;

	useEffect(() => {
		if (!projectPath) {
			setLoading(false);
			return;
		}
		rpc()
			.request.readWorkflow({ projectPath })
			.then((wf) => {
				if (wf) {
					setConfig(wf.config);
					setPromptBody(wf.promptBody);
				}
				setLoading(false);
				return undefined;
			})
			.catch(() => setLoading(false));
	}, [projectPath]);

	const update = useCallback(
		(fn: (c: WorkflowConfig) => WorkflowConfig) => {
			setConfig((prev) => {
				const next = fn(prev);
				if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
				saveTimeoutRef.current = setTimeout(() => {
					if (!project) return;
					rpc().request.saveWorkflow({
						projectPath: project.path,
						workflow: { config: next, promptBody: promptBodyRef.current },
					});
				}, 800);
				return next;
			});
		},
		[project],
	);

	const openInEditor = useCallback(() => {
		if (!project) return;
		rpc().request.openInEditor({ projectPath: project.path });
	}, [project]);

	const value = useMemo<SettingsContextValue>(
		() => ({
			state: { config, loading, section },
			actions: { update, openInEditor, setSection },
		}),
		[config, loading, section, update, openInEditor],
	);

	return <SettingsContext value={value}>{children}</SettingsContext>;
}

// ── NavItem ──────────────────────────────────────────

function NavItem({
	item,
	isActive,
	onSelect,
}: {
	item: (typeof NAV_ITEMS)[number];
	isActive: boolean;
	onSelect: (section: SettingsSection) => void;
}) {
	const handleClick = useCallback(
		() => onSelect(item.section),
		[onSelect, item.section],
	);

	return (
		<SidebarMenuItem>
			<SidebarMenuButton size="sm" isActive={isActive} onClick={handleClick}>
				<item.icon className="size-3.5" />
				{item.title}
			</SidebarMenuButton>
		</SidebarMenuItem>
	);
}

// ── Sidebar ──────────────────────────────────────────

function SettingsSidebar() {
	const { state: appState } = use(AppContext)!;
	const { state, actions } = useSettings();
	const project = appState.project;

	return (
		<Sidebar variant="floating" collapsible="none">
			<SidebarHeader className="electrobun-webkit-app-region-drag pt-4 pl-3">
				<div className="electrobun-webkit-app-region-no-drag pb-2">
					<WindowChrome.Controls />
				</div>
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							size="lg"
							className="cursor-default electrobun-webkit-app-region-no-drag"
						>
							<Avatar
								name={project?.name ?? "Project"}
								variant="beam"
								size={32}
								className="rounded-lg"
							/>
							<div className="flex flex-col gap-1 leading-none">
								<span className="font-medium truncate">
									{project?.name ?? "Project"}
								</span>
								<span className="text-[10px] text-sidebar-foreground/50">
									Configuration
								</span>
							</div>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarMenu>
						{NAV_ITEMS.map((item) => (
							<NavItem
								key={item.section}
								item={item}
								isActive={state.section === item.section}
								onSelect={actions.setSection}
							/>
						))}
					</SidebarMenu>
				</SidebarGroup>
				<SidebarGroup className="mt-auto">
					<SidebarMenu>
						<SidebarMenuItem>
							<SidebarMenuButton
								size="sm"
								className="text-muted-foreground"
								onClick={actions.openInEditor}
							>
								<ExternalLink className="size-3.5" />
								Edit in editor
							</SidebarMenuButton>
						</SidebarMenuItem>
					</SidebarMenu>
				</SidebarGroup>
			</SidebarContent>
		</Sidebar>
	);
}

// ── Content ──────────────────────────────────────────

const SECTIONS: Record<SettingsSection, () => ReactNode> = {
	workflow: () => <TrackerSection />,
	agent: () => <AgentSection />,
	advanced: () => (
		<>
			<AgentLimitsSection />
			<WorkspaceSection />
		</>
	),
};

function SettingsContent() {
	const { state } = useSettings();

	if (state.loading) {
		return (
			<div className="flex flex-1 items-center justify-center">
				<Spinner />
			</div>
		);
	}

	return (
		<div className="flex-1 overflow-y-auto min-h-0">
			<div className="space-y-5 px-4 py-3">{SECTIONS[state.section]()}</div>
		</div>
	);
}

// ── Settings ─────────────────────────────────────────

export function Settings({ projectId }: { projectId: string }) {
	return (
		<SettingsProvider projectId={projectId}>
			<WindowChrome.Root>
				<WindowChrome.Content>
					<div className="flex flex-1 min-h-0 view-enter">
						<SidebarProvider style={SIDEBAR_STYLE} className="min-h-0 flex-1">
							<SettingsSidebar />
							<SidebarInset className="flex flex-col min-h-0">
								<div className="electrobun-webkit-app-region-drag h-10 shrink-0" />
								<SettingsContent />
							</SidebarInset>
						</SidebarProvider>
					</div>
				</WindowChrome.Content>
			</WindowChrome.Root>
		</SettingsProvider>
	);
}

export { useSettings } from "./context";
export type { SettingsSection } from "./context";
