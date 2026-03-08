import { useDashboard } from "./root";
import { ObservabilitySection } from "./observability-section";

export function OpsPanel() {
	const { state } = useDashboard();
	if (!state.opsOpen) return null;

	return (
		<div className="view-shell">
			<ObservabilitySection />
		</div>
	);
}
