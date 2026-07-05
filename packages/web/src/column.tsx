import { useEffect, useState } from "react";
import type { WebDashboardProjection } from "./api.js";
import { Brief, BriefProvider } from "./brief.js";
import { formatAgo } from "./format.js";
import { Inspector } from "./inspector.js";
import { cn } from "./lib/utils.js";
import type { PlotRun } from "./run.js";
import { useSession } from "./session-context.js";
import { useLastSeen } from "./use-last-seen.js";
import { useQueueKeys } from "./use-queue-keys.js";

const formatScrubAgo = (atMs: number): string => formatAgo(atMs);

const parseWorkKeyHash = (): string | undefined => {
	const match = /^#wi=(.+)$/.exec(window.location.hash);
	return match?.[1] === undefined ? undefined : decodeURIComponent(match[1]);
};

/** Selection lives in the URL hash: rows are links, back button closes. */
const useSelectedWorkKey = (): string | undefined => {
	const [key, setKey] = useState(parseWorkKeyHash);
	useEffect(() => {
		const onChange = () => setKey(parseWorkKeyHash());
		window.addEventListener("hashchange", onChange);
		return () => window.removeEventListener("hashchange", onChange);
	}, []);
	return key;
};

export function SessionColumn({
	paletteOpen,
	projection,
	run,
}: {
	readonly paletteOpen: boolean;
	readonly projection: WebDashboardProjection;
	readonly run: PlotRun;
}) {
	const session = useSession();
	const activeProjection = session.state.projection ?? projection;
	const anchorMs = useLastSeen(activeProjection.sessionId);
	const selectedKey = useSelectedWorkKey();
	useQueueKeys({
		active:
			selectedKey === undefined && !session.state.scrubbing && !paletteOpen,
	});
	return (
		<div className="flex min-h-0 flex-1">
			<div
				className={cn(
					"flex min-h-0 flex-1",
					session.state.scrubbing && "console-past",
				)}
			>
				<BriefProvider anchorMs={anchorMs}>
					<Brief.Frame>
						{session.state.playheadMs !== undefined && (
							<p className="text-xs text-muted-foreground">
								viewing {formatScrubAgo(session.state.playheadMs)} ago — release
								to return
							</p>
						)}
						{session.state.playheadMs === undefined && <Brief.Headline />}
						<Brief.NeedsYou />
						<Brief.Acting />
						<Brief.ComingUp />
						<Brief.Outcomes />
					</Brief.Frame>
				</BriefProvider>
			</div>
			{selectedKey !== undefined && (
				<Inspector
					onClose={() => {
						window.location.hash = "";
					}}
					projection={activeProjection}
					sessionRunId={run.id}
					workKey={selectedKey}
				/>
			)}
		</div>
	);
}
