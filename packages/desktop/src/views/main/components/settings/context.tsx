import { createContext, use } from "react";
import type { WorkflowConfig } from "../../../../shared/rpc";

export type SettingsSection = "workflow" | "agent" | "advanced";

interface SettingsState {
	config: WorkflowConfig;
	loading: boolean;
	section: SettingsSection;
}

interface SettingsActions {
	update: (fn: (c: WorkflowConfig) => WorkflowConfig) => void;
	openInEditor: () => void;
	setSection: (section: SettingsSection) => void;
}

export interface SettingsContextValue {
	state: SettingsState;
	actions: SettingsActions;
}

export const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
	const ctx = use(SettingsContext);
	if (!ctx) throw new Error("Settings components must be used inside Settings");
	return ctx;
}
