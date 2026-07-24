import type {
	OperatorAction,
	WorkDisplay,
	WorkSubject,
} from "@plot/sdk/work-contract";
import type {
	WorkItemProjection,
	WorkStatus,
	WorkSubjectProjection,
} from "./types.js";

interface DisplayableWork {
	readonly workKey: string;
	readonly sourceId: string;
	readonly status?: WorkStatus;
	readonly subject?: string | WorkSubject | undefined;
	readonly title?: string;
	readonly display?: WorkDisplay | undefined;
	readonly blockedReason?: string;
	readonly operatorActions?: readonly OperatorAction[] | undefined;
	readonly currentRunId?: string;
}

export const subjectKeyFor = (sourceId: string, subjectId: string): string =>
	JSON.stringify([sourceId, subjectId]);

const observedSubject = (
	subject: DisplayableWork["subject"],
	previous?: WorkItemProjection,
): WorkSubject | undefined => {
	if (typeof subject === "string") return { id: subject };
	if (subject !== undefined) return subject;
	if (previous?.subject === undefined) return;
	const restored: {
		id: string;
		display?: NonNullable<WorkSubject["display"]>;
		progress?: NonNullable<WorkSubject["progress"]>;
	} = { id: previous.subject };
	if (previous.subjectDisplay !== undefined)
		restored.display = previous.subjectDisplay;
	if (previous.subjectProgress !== undefined)
		restored.progress = previous.subjectProgress;
	return restored;
};

export const displayWork = (
	work: DisplayableWork,
	previous?: WorkItemProjection,
): WorkItemProjection => {
	const subject = observedSubject(work.subject, previous);
	return {
		workKey: work.workKey,
		sourceId: work.sourceId,
		subject: subject?.id,
		subjectKey:
			subject === undefined
				? undefined
				: subjectKeyFor(work.sourceId, subject.id),
		subjectDisplay: subject?.display,
		subjectProgress: subject?.progress,
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
	} as WorkItemProjection;
};

export const subjectsFromWork = (
	work: ReadonlyMap<string, WorkItemProjection>,
): ReadonlyMap<string, WorkSubjectProjection> => {
	const subjects = new Map<string, WorkSubjectProjection>();
	const presentationPriority = new Map<string, number>();
	for (const item of work.values()) {
		if (item.subject === undefined || item.subjectKey === undefined) continue;
		const previous = subjects.get(item.subjectKey);
		const priority = item.status === "draining" ? 0 : 1;
		const replacePresentation =
			previous === undefined ||
			priority >= (presentationPriority.get(item.subjectKey) ?? 0);
		subjects.set(item.subjectKey, {
			subjectKey: item.subjectKey,
			sourceId: item.sourceId,
			id: item.subject,
			display:
				item.subjectDisplay !== undefined &&
				(replacePresentation || previous?.display === undefined)
					? item.subjectDisplay
					: previous?.display,
			progress:
				item.subjectProgress !== undefined &&
				(replacePresentation || previous?.progress === undefined)
					? item.subjectProgress
					: previous?.progress,
			workKeys: [...(previous?.workKeys ?? []), item.workKey],
		});
		if (replacePresentation)
			presentationPriority.set(item.subjectKey, priority);
	}
	return subjects;
};

export const workLabel = (work: {
	readonly primary?: string | undefined;
	readonly title: string;
}) => (work.primary ? `${work.primary} ${work.title}` : work.title);
