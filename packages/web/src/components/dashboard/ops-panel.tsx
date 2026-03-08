import { ObservabilitySection } from "./observability-section";
import { RetrySection } from "./retry-section";

export function OpsPanel() {
	return (
		<div className="ops-panel">
			<div className="border-b border-border px-4 py-2">
				<span className="type-title">runtime</span>
			</div>
			<div className="flex-1 overflow-y-auto p-4 space-y-6">
				<RetrySection />
				<ObservabilitySection />
			</div>
		</div>
	);
}
