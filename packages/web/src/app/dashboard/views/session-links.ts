// Shared TanStack link contracts for navigating between the Lobby (`/`) and a
// session's Room (`/session/$sessionId`). Both preserve the controller/observer
// posture carried in the `?role=` search param (defaulting to controller), so
// every Link/navigate spot stays consistent. Kept here so the Lobby and the Room
// share one definition rather than each carrying an inline copy.

// Preserve the `?role=` posture across navigation, defaulting to controller.
export const roleSearch = (prev: { role?: "observer" | "controller" }) => ({
	role: prev.role ?? "controller",
});

// `{ to: "/session/$sessionId", … }` — navigate INTO a session's Room.
export const sessionLinkProps = (sessionId: string) =>
	({
		to: "/session/$sessionId",
		params: { sessionId },
		search: roleSearch,
	}) as const;

// `{ to: "/", … }` — the "← all work" back-link / lobby links.
export const lobbyLinkProps = {
	to: "/" as const,
	search: roleSearch,
};
