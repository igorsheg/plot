import { expect, mock, test } from "bun:test";

// status.tsx pulls in @tanstack/react-router for the RoleToggle's useNavigate.
// The helpers under test are pure, but the module-level import still resolves,
// so stub the router the same way the dashboard render test does.
mock.module("@tanstack/react-router", () => ({
	useNavigate: () => () => undefined,
	Link: () => null,
}));

const { connectionLabel, connectionTone } =
	await import("../src/app/dashboard/views/status");

test("connectionLabel maps each connection state to its chrome label", () => {
	expect(connectionLabel("online")).toBe("online");
	expect(connectionLabel("connecting")).toBe("connecting");
	expect(connectionLabel("offline")).toBe("offline · last frame");
	expect(connectionLabel("handoff-missing")).toBe("handoff needed");
});

test("connectionTone keeps the accent off non-actionable degraded states", () => {
	expect(connectionTone("online")).toBe("online");
	expect(connectionTone("connecting")).toBe("muted");
	expect(connectionTone("offline")).toBe("attention");
	expect(connectionTone("handoff-missing")).toBe("attention");
});
