import {
	BrowserWindow,
	BrowserView,
	Utils,
	ApplicationMenu,
} from "electrobun/bun";
import { Effect, ManagedRuntime, Stream } from "effect";
import type { DesktopRPC } from "../shared/rpc";
import { DesktopMain } from "./services/desktop-main";
import { createTray } from "./tray";

const DEV_PORT = 5174;
const DEV_URL = `http://localhost:${DEV_PORT}`;

async function getViewUrl(): Promise<string> {
	try {
		await fetch(DEV_URL, { method: "HEAD" });
		return DEV_URL;
	} catch {
		return "views://main/index.html";
	}
}

Utils.setDockIconVisible(false);

ApplicationMenu.setApplicationMenu([
	{ submenu: [{ role: "quit" }] },
	{
		label: "Edit",
		submenu: [
			{ role: "undo" },
			{ role: "redo" },
			{ type: "separator" },
			{ role: "cut" },
			{ role: "copy" },
			{ role: "paste" },
			{ role: "selectAll" },
		],
	},
]);

const runtime = ManagedRuntime.make(DesktopMain.layer);

const run = <A, E>(effect: Effect.Effect<A, E, DesktopMain>) =>
	runtime.runPromise(effect);

const fire = <A, E>(effect: Effect.Effect<A, E, DesktopMain>) =>
	runtime.runFork(effect);

type ConfigWindowEntry = {
	win: BrowserWindow;
	rpc: ReturnType<typeof BrowserView.defineRPC<DesktopRPC>>;
};
const configWindows = new Map<string, ConfigWindowEntry>();

function sendToWindow(
	projectId: string,
	fn: (send: ConfigWindowEntry["rpc"]["send"]) => void,
) {
	const entry = configWindows.get(projectId);
	if (entry) fn(entry.rpc.send);
}

function sendToAll(fn: (send: ConfigWindowEntry["rpc"]["send"]) => void) {
	for (const [, entry] of configWindows) fn(entry.rpc.send);
}

async function openConfigWindow(projectId: string) {
	const existing = configWindows.get(projectId);
	if (existing) {
		existing.win.focus();
		return;
	}

	const project = await run(
		Effect.gen(function* () {
			const d = yield* DesktopMain;
			return yield* d.getProjectInfo(projectId);
		}),
	);
	if (!project) return;

	let win: BrowserWindow;

	const rpc = BrowserView.defineRPC<DesktopRPC>({
		handlers: {
			requests: {
				getProject: ({ projectId: id }) =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							return yield* d.getProjectInfo(id);
						}),
					),
				readWorkflow: ({ projectPath }) =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							return yield* d.readWorkflow(projectPath);
						}),
					),
				saveWorkflow: ({ projectPath, workflow }) =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							yield* d.saveWorkflow(projectPath, workflow);
							return true;
						}),
					),
				createWorkflow: ({ projectPath, template }) =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							return yield* d.createWorkflow(projectPath, template);
						}),
					),
				openInEditor: ({ projectPath }) =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							yield* d.openInEditor(projectPath);
							return true;
						}),
					),
				getProviders: () =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							return [...(yield* d.getProviders)];
						}),
					),
				getAuthStatus: () =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							return [...(yield* d.getAuthStatus)];
						}),
					),
				startAuthFlow: ({ providerId }) => {
					fire(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							yield* d.startAuthLogin(providerId);
						}),
					);
					return Promise.resolve(true);
				},
				submitAuthResponse: ({ value }) =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							yield* d.submitAuthResponse(value);
						}),
					).then(() => true),
				windowClose: () => {
					win.close();
					return Promise.resolve(true);
				},
				windowMinimize: () => {
					win.minimize();
					return Promise.resolve(true);
				},
				windowZoom: () => {
					win.maximize();
					return Promise.resolve(true);
				},
			},
			messages: {},
		},
	});

	const url = await getViewUrl();
	const sep = url.includes("?") ? "&" : "?";

	win = new BrowserWindow({
		title: `Plot — ${project.name}`,
		url: `${url}${sep}projectId=${projectId}`,
		titleBarStyle: "hidden",
		rpc,
		frame: { width: 480, height: 540, x: 200, y: 200 },
	});

	configWindows.set(projectId, { win, rpc });
	win.on("close", () => {
		configWindows.delete(projectId);
	});
}

const tray = createTray({
	onConfigure: (id) => openConfigWindow(id),
	onStartProject: (id) => {
		fire(
			Effect.gen(function* () {
				const d = yield* DesktopMain;
				yield* d.startProject(id);
			}),
		);
	},
	onStopProject: (id) => {
		fire(
			Effect.gen(function* () {
				const d = yield* DesktopMain;
				yield* d.stopProject(id);
			}),
		);
	},
	onStartAll: () => {
		fire(
			Effect.gen(function* () {
				const d = yield* DesktopMain;
				yield* d.startAll;
			}),
		);
	},
	onStopAll: () => {
		fire(
			Effect.gen(function* () {
				const d = yield* DesktopMain;
				yield* d.stopAll;
			}),
		);
	},
	onOpenInFinder: (p) => Utils.showItemInFolder(p),
	onRemoveProject: (id) => {
		fire(
			Effect.gen(function* () {
				const d = yield* DesktopMain;
				yield* d.removeProject(id);
			}),
		);
		const entry = configWindows.get(id);
		if (entry) {
			entry.win.close();
			configWindows.delete(id);
		}
	},
	onAddProject: async () => {
		const chosen = await Utils.openFileDialog({
			startingFolder: Utils.paths.home,
			allowedFileTypes: "*",
			canChooseFiles: false,
			canChooseDirectory: true,
			allowsMultipleSelection: false,
		});
		if (!chosen || chosen.length === 0) return;
		const project = await run(
			Effect.gen(function* () {
				const d = yield* DesktopMain;
				return yield* d.addProject(chosen[0]!);
			}),
		);
		const infos = await run(
			Effect.gen(function* () {
				const d = yield* DesktopMain;
				return yield* d.listProjectInfos;
			}),
		);
		tray.refresh([...infos]);
		openConfigWindow(project.id);
	},
	onQuit: async () => {
		await run(
			Effect.gen(function* () {
				const d = yield* DesktopMain;
				yield* d.shutdown;
			}),
		);
		Utils.quit();
	},
});

fire(
	Effect.gen(function* () {
		const d = yield* DesktopMain;
		yield* d.statusStream.pipe(
			Stream.runForEach((event) =>
				Effect.gen(function* () {
					const infos = yield* d.listProjectInfos;
					yield* Effect.sync(() => {
						tray.refresh([...infos]);
						const info = infos.find((i) => i.id === event.projectId);
						if (info)
							sendToWindow(event.projectId, (send) =>
								send.projectUpdated(info),
							);
					});
				}),
			),
		);
	}),
);

fire(
	Effect.gen(function* () {
		const d = yield* DesktopMain;
		yield* d.snapshotStream.pipe(
			Stream.runForEach((event) =>
				Effect.sync(() => {
					sendToWindow(event.projectId, (send) => send.snapshotUpdate(event));
				}),
			),
		);
	}),
);

fire(
	Effect.gen(function* () {
		const d = yield* DesktopMain;
		yield* d.authStateStream.pipe(
			Stream.runForEach((state) =>
				Effect.sync(() => {
					sendToAll((send) => send.authStateChanged(state));
				}),
			),
		);
	}),
);

run(
	Effect.gen(function* () {
		const d = yield* DesktopMain;
		return yield* d.listProjectInfos;
	}),
).then((infos) => tray.refresh([...infos]));
