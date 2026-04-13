export type HealthStatus = "pass" | "warn" | "fail";

export interface HealthCheckResult {
	readonly componentId?: string;
	readonly observedValue?: number;
	readonly observedUnit?: string;
	readonly status: HealthStatus;
	readonly time?: string;
}

export interface HealthResponse {
	readonly status: HealthStatus;
	readonly version?: string;
	readonly description?: string;
	readonly checks?: Record<string, readonly HealthCheckResult[]>;
}
