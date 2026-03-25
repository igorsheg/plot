import { BrowserWindow, Tray } from "electrobun/bun";

const tray = new Tray({ title: "Plot" });

const win = new BrowserWindow({
	title: "Plot",
	url: "views://main/index.html",
	frame: {
		width: 480,
		height: 720,
		x: 100,
		y: 100,
	},
});

tray.on("tray-clicked", (e) => {
	const event = e as { data: { action: string } };
	if (event.data.action === "") win.focus();
});
