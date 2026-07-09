import { isRecord, type Mutable } from "@plot/common/primitives";
import { str } from "./helpers.js";
import type { WorkItemProjection, WorkStatus } from "./types.js";

const display = (v: unknown) => (isRecord(v) ? v : {});
const workStatus = (value: unknown): WorkStatus | undefined => {
	const status = str(value);
	return status === "pending" ||
		status === "waiting" ||
		status === "running" ||
		status === "blocked" ||
		status === "draining"
		? status
		: undefined;
};

export const displayWork = (
	value: unknown,
	previous?: WorkItemProjection,
): WorkItemProjection => {
	const work = display(value);
	const d = display(work["display"]);
	const key = String(work["workKey"] ?? previous?.workKey ?? "work");
	const item: Mutable<WorkItemProjection> = {
		workKey: key,
		sourceId: String(work["sourceId"] ?? previous?.sourceId ?? "source"),
		primary: str(d["primary"]) ?? previous?.primary,
		title: str(d["title"]) ?? str(work["title"]) ?? previous?.title ?? key,
		labels: Array.isArray(d["labels"])
			? d["labels"].filter((x): x is string => typeof x === "string")
			: (previous?.labels ?? []),
		status: workStatus(work["status"]) ?? previous?.status ?? "pending",
	};
	const subject = str(work["subject"]);
	const subtitle = str(d["subtitle"]);
	const url = str(d["url"]);
	const version = str(d["version"]);
	const blockedReason = str(work["blockedReason"]);
	const currentRunId = str(work["currentRunId"]);
	if (subject !== undefined) item.subject = subject;
	if (subtitle !== undefined) item.subtitle = subtitle;
	if (url !== undefined) item.url = url;
	if (version !== undefined) item.version = version;
	if (blockedReason !== undefined) item.blockedReason = blockedReason;
	if (Array.isArray(work["operatorActions"]))
		item.operatorActions = work["operatorActions"];
	else if (previous?.operatorActions !== undefined)
		item.operatorActions = previous.operatorActions;
	if (currentRunId !== undefined) item.currentRunId = currentRunId;
	return item;
};

export const workLabel = (work: {
	readonly primary?: string | undefined;
	readonly title: string;
}) =>
	work.primary === undefined ? work.title : `${work.primary} ${work.title}`;
