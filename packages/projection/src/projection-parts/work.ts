import type { OperatorAction, WorkDisplay } from "@plot/sdk/work-contract";
import type { WorkItemProjection, WorkStatus } from "./types.js";

interface DisplayableWork {
	readonly workKey: string;
	readonly sourceId: string;
	readonly status?: WorkStatus;
	readonly subject?: string | undefined;
	readonly title?: string;
	readonly display?: WorkDisplay | undefined;
	readonly blockedReason?: string;
	readonly operatorActions?: readonly OperatorAction[] | undefined;
	readonly currentRunId?: string;
}

export const displayWork = (
	work: DisplayableWork,
	previous?: WorkItemProjection,
): WorkItemProjection =>
	({
		workKey: work.workKey,
		sourceId: work.sourceId,
		subject: work.subject ?? previous?.subject,
		primary: work.display?.primary ?? previous?.primary,
		title: work.display?.title ?? work.title ?? previous?.title ?? work.workKey,
		subtitle: work.display?.subtitle ?? previous?.subtitle,
		url: work.display?.url ?? previous?.url,
		version: work.display?.version ?? previous?.version,
		labels: work.display?.labels ?? previous?.labels ?? [],
		status: work.status ?? previous?.status ?? "pending",
		blockedReason: work.blockedReason ?? previous?.blockedReason,
		operatorActions: work.operatorActions ?? previous?.operatorActions,
		currentRunId: work.currentRunId,
	}) as WorkItemProjection;

export const workLabel = (work: {
	readonly primary?: string | undefined;
	readonly title: string;
}) => (work.primary ? `${work.primary} ${work.title}` : work.title);
