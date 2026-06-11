export interface RenderSchedulerOptions {
	readonly minIntervalMs: number;
	readonly animationFrameMs: number;
	readonly fingerprint: () => string;
	readonly isAnimationActive: () => boolean;
	readonly requestRender: () => void;
	readonly now?: () => number;
	readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
	readonly clearTimer?: (timer: unknown) => void;
}

export class RenderScheduler {
	private readonly now: () => number;
	private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
	private readonly clearTimer: (timer: unknown) => void;
	private lastFingerprint = "";
	private lastRenderAtMs = 0;
	private pendingRender: unknown;
	private animationRender: unknown;
	private stopped = false;

	constructor(private readonly options: RenderSchedulerOptions) {
		this.now = options.now ?? Date.now;
		this.setTimer =
			options.setTimer ??
			((callback, delayMs) => setTimeout(callback, delayMs));
		this.clearTimer =
			options.clearTimer ??
			((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
	}

	notifyChanged(): void {
		if (this.stopped) return;
		const fingerprint = this.options.fingerprint();
		if (fingerprint === this.lastFingerprint) {
			this.scheduleAnimationRender();
			return;
		}
		const elapsed = this.now() - this.lastRenderAtMs;
		if (elapsed >= this.options.minIntervalMs) this.renderNow();
		else if (this.pendingRender === undefined)
			this.pendingRender = this.setTimer(
				() => this.renderNow(),
				this.options.minIntervalMs - elapsed,
			);
	}

	stop(): void {
		this.stopped = true;
		if (this.pendingRender !== undefined) this.clearTimer(this.pendingRender);
		if (this.animationRender !== undefined)
			this.clearTimer(this.animationRender);
		this.pendingRender = undefined;
		this.animationRender = undefined;
	}

	private renderNow(): void {
		if (this.stopped) return;
		this.pendingRender = undefined;
		this.lastFingerprint = this.options.fingerprint();
		this.lastRenderAtMs = this.now();
		this.options.requestRender();
		this.scheduleAnimationRender();
	}

	private scheduleAnimationRender(): void {
		if (
			this.stopped ||
			!this.options.isAnimationActive() ||
			this.animationRender !== undefined
		)
			return;
		this.animationRender = this.setTimer(() => {
			this.animationRender = undefined;
			this.notifyChanged();
		}, this.options.animationFrameMs);
	}
}
