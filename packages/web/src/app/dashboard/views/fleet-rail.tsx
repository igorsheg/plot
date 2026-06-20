import { Card, CardHeader, CardPanel } from "@/components/ui/card";
import { InputCopy } from "@/components/ui/input-copy";
import { useDashboardState } from "../dashboard-context";
import { SectionLabel, Stack } from "./layout";

// The `/` pane: only the empty/offline state. With the fleet always in the
// sidebar, there is no "pick a session" prompt — landing online with a roster
// dives into the top session; landing with nothing shows how to start one.
export function OverviewPane() {
	return <EmptyOrOffline />;
}

function EmptyOrOffline() {
	const { roster, connection, lastError } = useDashboardState();
	if (roster.length > 0) return null;
	return (
		<div className="flex flex-1 items-center justify-center py-20">
			<Card className="max-w-lg">
				<CardHeader>
					<SectionLabel>
						{connection === "offline" ? "Offline" : "No Plot Sessions"}
					</SectionLabel>
				</CardHeader>
				<CardPanel>
					<Stack gap={3} className="text-sm text-t3">
						<p>
							{lastError ?? "Start a Plot Session, then refresh this page."}
						</p>
						<InputCopy value="plot --workflow WORKFLOW.md" />
						<InputCopy value="plot run --workflow WORKFLOW.md" />
					</Stack>
				</CardPanel>
			</Card>
		</div>
	);
}
