import { type ReactNode, useCallback } from "react";
import { useDashboard } from "./root";
import { statusLabel, statusVariant } from "./status";
import { formatTokens, formatTimeAgo } from "@/lib/format";
import { useIssueDetail, useRuntimeSnapshot } from "@/lib/runtime";
import { useEventLog } from "@/lib/use-event-log";
import { Badge } from "@/components/ui/badge";
import {
	Sheet,
	SheetDescription,
	SheetHeader,
	SheetPanel,
	SheetPopup,
	SheetTitle,
} from "@/components/ui/sheet";
import { TraceViewer } from "@/components/trace-viewer";

function SectionCard(props: {
	title: string;
	children: ReactNode;
	meta?: string | null;
}) {
	return (
		<section className="rounded-lg border border-border bg-card/60 p-3">
			<div className="mb-2 flex items-center justify-between gap-3">
				<h3 className="type-label text-foreground">{props.title}</h3>
				{props.meta ? <span className="type-meta">{props.meta}</span> : null}
			</div>
			<div className="type-body whitespace-pre-wrap text-muted-foreground">
				{props.children}
			</div>
		</section>
	);
}

export function WorkDetailSheet() {
	const {
		state: { focusedIssueId },
		actions,
	} = useDashboard();
	const snapshot = useRuntimeSnapshot();
	const entry = focusedIssueId
		? snapshot?.running.find(
				(runningEntry) => runningEntry.issueId === focusedIssueId,
			)
		: undefined;

	const open = !!entry;
	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (!nextOpen) actions.focusIssue(null);
		},
		[actions],
	);

	const session = entry?.session;
	const lastUpdated = session?.lastEventAt
		? formatTimeAgo(session.lastEventAt)
		: null;
	const identifier = entry?.issueIdentifier ?? "";
	const { events, isLoading: logLoading } = useEventLog(open ? identifier : "");
	const { data: issueDetail } = useIssueDetail(open ? identifier : "");
	const promptSnapshot = issueDetail?.promptSnapshot ?? null;
	const runContext = issueDetail?.runContext ?? null;

	return (
		<Sheet onOpenChange={handleOpenChange} open={open}>
			<SheetPopup side="right" variant="inset">
				{entry && session ? (
					<>
						<SheetHeader className="section-shell pr-12">
							<div className="cluster-shell">
								<SheetTitle className="type-title">
									{entry.issueIdentifier}
								</SheetTitle>
								<Badge variant={statusVariant(entry.state)} size="sm">
									{statusLabel(entry.state)}
								</Badge>
							</div>
							<SheetDescription className="type-meta">
								{lastUpdated
									? `last update ${lastUpdated}`
									: "waiting for first update"}
								{" · "}turn {session.turnCount} ·{" "}
								{formatTokens(session.totalTokens)} tokens
							</SheetDescription>
						</SheetHeader>
						<SheetPanel className="flex flex-1 flex-col gap-3 overflow-y-auto pt-0">
							{promptSnapshot ? (
								<div className="grid gap-3 xl:grid-cols-2">
									<SectionCard
										title="prompt compiler"
										meta={`system ${promptSnapshot.systemCharCount} · user ${promptSnapshot.userCharCount}`}
									>
										{[
											`stable prefix hash: ${promptSnapshot.stablePrefixHash}`,
											"",
											...promptSnapshot.systemSections.map(
												(section) =>
													`system · ${section.title} (${section.charCount})`,
											),
											...promptSnapshot.userSections.map(
												(section) =>
													`user · ${section.title} (${section.charCount})`,
											),
										].join("\n")}
									</SectionCard>
									<SectionCard
										title="workpad"
										meta={
											runContext?.workpadSections.length
												? `${runContext.workpadSections.length} sections`
												: null
										}
									>
										{runContext?.workpadSections.length
											? runContext.workpadSections
													.map(
														(section) =>
															`${section.title}${section.itemCount > 0 ? ` (${section.itemCount} items)` : ""}\n${section.body}`,
													)
													.join("\n\n")
											: (runContext?.workpad ?? "no parsed workpad context")}
									</SectionCard>
									<SectionCard title="system prompt">
										{promptSnapshot.system}
									</SectionCard>
									<SectionCard title="user prompt">
										{promptSnapshot.user}
									</SectionCard>
								</div>
							) : null}
							<div className="min-h-[28rem] overflow-hidden rounded-lg border border-border">
								<TraceViewer.Root
									events={events}
									issueId={entry.issueId}
									issueIdentifier={entry.issueIdentifier}
									isLoading={logLoading}
								>
									<TraceViewer.Toolbar />
									<TraceViewer.EventList />
									<TraceViewer.DetailPane />
								</TraceViewer.Root>
							</div>
						</SheetPanel>
					</>
				) : null}
			</SheetPopup>
		</Sheet>
	);
}
