type SlotState<Session> =
	| { readonly phase: "idle" }
	| { readonly phase: "starting"; readonly work: Promise<Session> }
	| { readonly phase: "online"; readonly session: Session }
	| {
			readonly phase: "stopping";
			readonly session: Session;
			readonly work: Promise<Session>;
	  };

class SessionSlot<Session> {
	private state: SlotState<Session> = { phase: "idle" };

	get phase(): SlotState<Session>["phase"] {
		return this.state.phase;
	}

	get session(): Session | undefined {
		return this.state.phase === "online" || this.state.phase === "stopping"
			? this.state.session
			: undefined;
	}

	async start(create: () => Promise<Session>): Promise<{
		readonly session: Session;
		readonly started: boolean;
	}> {
		for (;;) {
			const state = this.state;
			if (state.phase === "online")
				return { session: state.session, started: false };
			if (state.phase === "starting")
				return { session: await state.work, started: false };
			if (state.phase === "stopping") {
				await state.work.catch(() => undefined);
				continue;
			}
			const work = create();
			this.state = { phase: "starting", work };
			try {
				const session = await work;
				this.state = { phase: "online", session };
				return { session, started: true };
			} catch (error) {
				this.state = { phase: "idle" };
				throw error;
			}
		}
	}

	async stop(
		close: (session: Session) => Promise<Session>,
		expected?: Session,
	): Promise<Session | undefined> {
		for (;;) {
			const state = this.state;
			if (state.phase === "idle") return;
			if (state.phase === "starting") {
				try {
					await state.work;
				} catch {
					return;
				}
				continue;
			}
			if (expected !== undefined && state.session !== expected) return;
			if (state.phase === "stopping") return state.work;
			const work = close(state.session).finally(() => {
				this.state = { phase: "idle" };
			});
			this.state = { phase: "stopping", session: state.session, work };
			return work;
		}
	}
}

export type SessionCloseReason = "stop" | "failure" | "dispose";

export interface SessionCloseContext {
	readonly reason: SessionCloseReason;
	readonly error?: unknown;
}

export interface SessionIdentity<Key> {
	readonly key: Key;
	readonly aliases: ReadonlySet<Key>;
}

export interface SessionTarget<Key, Target> {
	readonly key: Key;
	readonly aliases?: readonly Key[];
	readonly target: Target;
}

export interface OwnedSession {
	readonly close: (context: SessionCloseContext) => Promise<void>;
}

/**
 * Creates one Session from an environment-resolved target.
 *
 * The factory closes over fixed host policy. Owner stores and reuses it so
 * value/in-process and file/worker composition share one lifecycle owner.
 */
export type CreateSessionFactory<Key, Target, Session> = (input: {
	readonly target: Target;
	readonly identity: SessionIdentity<Key>;
}) => Promise<Session>;

interface IdentityEntry<Key, Session extends OwnedSession> {
	readonly identity: {
		readonly key: Key;
		readonly aliases: Set<Key>;
	};
	readonly slot: SessionSlot<Session>;
}

/** Owns Workflow identity, Session cardinality, and lifecycle ordering. */
export class Owner<Key, Target, Session extends OwnedSession> {
	private readonly identities = new Map<Key, IdentityEntry<Key, Session>>();
	private readonly entries = new Map<
		SessionIdentity<Key>,
		IdentityEntry<Key, Session>
	>();
	private accepting = true;
	private disposal: Promise<void> | undefined;

	constructor(
		private readonly createSession: CreateSessionFactory<Key, Target, Session>,
		private readonly closedError: () => Error = () =>
			new Error("Owner is closed"),
	) {}

	async start(input: SessionTarget<Key, Target>): Promise<{
		readonly session: Session;
		readonly started: boolean;
	}> {
		this.assertAccepting();
		const entry = this.entryFor(input.key, input.aliases ?? []);
		return entry.slot.start(() => {
			this.assertAccepting();
			return this.createSession({
				target: input.target,
				identity: entry.identity,
			});
		});
	}

	find(keys: Iterable<Key>): Session | undefined {
		const entry = this.resolve(keys);
		return entry?.slot.phase === "online" ? entry.slot.session : undefined;
	}

	sessions(): readonly Session[] {
		return [...this.entries.values()].flatMap((entry) => {
			const session = entry.slot.session;
			return session === undefined ? [] : [session];
		});
	}

	stop(keys: Iterable<Key>, expected?: Session): Promise<Session | undefined> {
		const entry = this.resolve(keys);
		return entry === undefined
			? Promise.resolve(undefined)
			: this.stopEntry(entry, { reason: "stop" }, expected);
	}

	stopOwned(
		identity: SessionIdentity<Key>,
		expected?: Session,
	): Promise<Session | undefined> {
		const entry = this.entries.get(identity);
		return entry === undefined
			? Promise.resolve(undefined)
			: this.stopEntry(entry, { reason: "stop" }, expected);
	}

	fail(
		identity: SessionIdentity<Key>,
		expected: Session,
		error: unknown,
	): Promise<Session | undefined> {
		const entry = this.entries.get(identity);
		return entry === undefined
			? Promise.resolve(undefined)
			: this.stopEntry(entry, { reason: "failure", error }, expected);
	}

	isControllable(identity: SessionIdentity<Key>, expected: Session): boolean {
		const entry = this.entries.get(identity);
		return (
			this.accepting &&
			entry?.slot.phase === "online" &&
			entry.slot.session === expected
		);
	}

	stopAccepting(): void {
		this.accepting = false;
	}

	dispose(): Promise<void> {
		this.disposal ??= (async () => {
			this.stopAccepting();
			const stopped = await Promise.allSettled(
				[...this.entries.values()].map((entry) =>
					this.stopEntry(entry, { reason: "dispose" }),
				),
			);
			this.identities.clear();
			this.entries.clear();
			const failure = stopped.find((result) => result.status === "rejected");
			if (failure?.status === "rejected") throw failure.reason;
		})();
		return this.disposal;
	}

	private assertAccepting(): void {
		if (!this.accepting) throw this.closedError();
	}

	private entryFor(
		key: Key,
		aliases: readonly Key[],
	): IdentityEntry<Key, Session> {
		const keys = [key, ...aliases];
		const found = new Set(
			keys.flatMap((candidate) => {
				const entry = this.identities.get(candidate);
				return entry === undefined ? [] : [entry];
			}),
		);
		if (found.size > 1)
			throw new Error("Conflicting Session lifecycle identity");
		let entry = found.values().next().value as
			| IdentityEntry<Key, Session>
			| undefined;
		if (entry === undefined) {
			entry = {
				identity: { key, aliases: new Set() },
				slot: new SessionSlot(),
			};
			this.entries.set(entry.identity, entry);
		}
		for (const candidate of keys) {
			entry.identity.aliases.add(candidate);
			this.identities.set(candidate, entry);
		}
		return entry;
	}

	private resolve(
		keys: Iterable<Key>,
	): IdentityEntry<Key, Session> | undefined {
		const found = new Set<IdentityEntry<Key, Session>>();
		for (const key of keys) {
			const entry = this.identities.get(key);
			if (entry !== undefined) found.add(entry);
		}
		if (found.size > 1)
			throw new Error("Conflicting Session lifecycle identity");
		return found.values().next().value;
	}

	private stopEntry(
		entry: IdentityEntry<Key, Session>,
		context: SessionCloseContext,
		expected?: Session,
	): Promise<Session | undefined> {
		return entry.slot.stop(async (session) => {
			await session.close(context);
			return session;
		}, expected);
	}
}

export const createOwner = <Key, Target, Session extends OwnedSession>(
	createSession: CreateSessionFactory<Key, Target, Session>,
	closedError?: () => Error,
): Owner<Key, Target, Session> => new Owner(createSession, closedError);
