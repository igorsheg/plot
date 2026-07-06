export interface WorkDisplay {
	readonly kind?: string;
	readonly primary?: string;
	readonly title?: string;
	readonly subtitle?: string;
	readonly url?: string;
	readonly version?: string;
	readonly labels?: readonly string[];
}

export interface OperatorActionConfirm {
	readonly title: string;
	readonly message?: string;
}

export interface OperatorAction {
	readonly id: string;
	readonly label: string;
	readonly tone?: "primary" | "secondary" | "danger";
	readonly disabledReason?: string;
	readonly requiresComment?: boolean;
	readonly confirm?: OperatorActionConfirm;
}
