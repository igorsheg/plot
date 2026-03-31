import { BrowserWindow, BrowserView, Utils, ApplicationMenu } from "electrobun/bun";
import { Effect, ManagedRuntime, Stream } from "effect";
import type { DesktopRPC, ProjectSnapshot } from "../shared/rpc";
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

const run = <A, E>(effect: Effect.Effect<A, E, DesktopMain>) => runtime.runPromise(effect);

const fire = <A, E>(effect: Effect.Effect<A, E, DesktopMain>) => runtime.runFork(effect);

const snapshotCache = new Map<string, ProjectSnapshot>();

let mainWindow: BrowserWindow | null = null;
let currentWindowKey: string | null = null;
let mainRpc: ReturnType<typeof BrowserView.defineRPC<DesktopRPC>> | null = null;

function sendToAll(fn: (send: NonNullable<typeof mainRpc>["send"]) => void) {
	if (mainRpc) fn(mainRpc.send);
}

let openingWindow = false;

async function openMainWindow(opts?: { projectId?: string; view?: string }) {
	const windowKey = opts?.view ?? opts?.projectId ?? null;

	if (openingWindow) return;

	if (mainWindow) {
		if (windowKey !== currentWindowKey) {
			const closingWindow = mainWindow;
			closingWindow.on("close", () => {
				if (mainWindow === closingWindow) {
					mainWindow = null;
					mainRpc = null;
					currentWindowKey = null;
				}
			});
			mainWindow.close();
			mainWindow = null;
			mainRpc = null;
		} else {
			mainWindow.focus();
			return;
		}
	}

	currentWindowKey = windowKey;
	openingWindow = true;

	const rpc = BrowserView.defineRPC<DesktopRPC>({
		handlers: {
			requests: {
				getProjectInfo: ({ projectId }) =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							return yield* d.getProjectInfo(projectId);
						}),
					),

				listProjects: () =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							return [...(yield* d.listProjectInfos)];
						}),
					),

				pickProjectFolder: async () => {
					const chosen = await Utils.openFileDialog({
						startingFolder: Utils.paths.home,
						allowedFileTypes: "*",
						canChooseFiles: false,
						canChooseDirectory: true,
						allowsMultipleSelection: false,
					});
					const path = chosen?.[0];
					if (!path) return null;
					sendToAll((send) => send.folderPicked({ path }));
					return path;
				},

				addProject: ({ folderPath }) =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							const project = yield* d.addProject(folderPath);
							const infos = yield* d.listProjectInfos;
							tray.refresh([...infos], snapshotCache);
							return project;
						}),
					),

				removeProject: ({ projectId }) =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							yield* d.removeProject(projectId);
							const infos = yield* d.listProjectInfos;
							tray.refresh([...infos], snapshotCache);
							return true;
						}),
					),

				startProject: ({ projectId }) => {
					fire(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							yield* d.startProject(projectId);
						}),
					);
					return Promise.resolve(true);
				},

				stopProject: ({ projectId }) => {
					fire(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							yield* d.stopProject(projectId);
						}),
					);
					return Promise.resolve(true);
				},

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

				createWorkflow: ({ projectPath, config }) =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							return yield* d.createWorkflow(projectPath, config);
						}),
					),

				getProviders: () =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							return [...(yield* d.getProviders)];
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

				saveApiKey: ({ providerId, key }) =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							yield* d.saveApiKey(providerId, key);
						}),
					).then(() => true),

				removeApiKey: ({ providerId }) =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							yield* d.removeApiKey(providerId);
						}),
					).then(() => true),

				openInEditor: ({ projectPath }) =>
					run(
						Effect.gen(function* () {
							const d = yield* DesktopMain;
							yield* d.openInEditor(projectPath);
							return true;
						}),
					),

				windowClose: () => {
					mainWindow?.close();
					return Promise.resolve(true);
				},
				windowMinimize: () => {
					mainWindow?.minimize();
					return Promise.resolve(true);
				},
				windowZoom: () => {
					mainWindow?.maximize();
					return Promise.resolve(true);
				},
			},
			messages: {},
		},
	});
	mainRpc = rpc;

	const url = await getViewUrl();
	const params = new URLSearchParams();
	if (opts?.projectId) params.set("projectId", opts.projectId);
	if (opts?.view) params.set("view", opts.view);
	const windowUrl = params.size > 0 ? `${url}?${params}` : url;
	mainWindow = new BrowserWindow({
		title: "Plot",
		url: windowUrl,
		titleBarStyle: "hidden",
		transparent: true,
		rpc,
		frame: { width: 720, height: 600, x: 200, y: 200 },
	});

	openingWindow = false;

	mainWindow.on("close", () => {
		mainWindow = null;
		mainRpc = null;
		currentWindowKey = null;
	});
}

const tray = createTray({
	onOpen: (projectId) => openMainWindow({ projectId }),
	onSettings: () => openMainWindow({ view: "settings" }),
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
		run(
			Effect.gen(function* () {
				const d = yield* DesktopMain;
				yield* d.removeProject(id);
				const infos = yield* d.listProjectInfos;
				return infos;
			}),
		).then((infos) => {
			tray.refresh([...infos], snapshotCache);
		});
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
		tray.refresh([...infos], snapshotCache);
		await openMainWindow({ projectId: project.id });
	},
	onQuit: async () => {
		// 1. Stop all projects and dispose auth (kill subprocesses, release ports)
		await run(
			Effect.gen(function* () {
				const d = yield* DesktopMain;
				yield* d.shutdown;
			}),
		).catch(() => {});
		// 2. Dispose the managed runtime (tears down service layer, interrupts fibers)
		await runtime.dispose().catch(() => {});
		// 3. Exit
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
						tray.refresh([...infos], snapshotCache);
						const info = infos.find((i) => i.id === event.projectId);
						if (info) sendToAll((send) => send.projectUpdated(info));
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
				Effect.gen(function* () {
					snapshotCache.set(event.projectId, event.snapshot);
					const infos = yield* d.listProjectInfos;
					yield* Effect.sync(() => {
						tray.refresh([...infos], snapshotCache);
					});
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
).then((infos) => tray.refresh([...infos], snapshotCache));
