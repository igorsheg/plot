import { processCliIo, type PlotCliIo } from "./io.js";

// Module-level singleton: citty run() handlers receive no context, so IO is threaded here.
let currentIo: PlotCliIo = processCliIo();

export const setCliIo = (io: PlotCliIo) => {
	currentIo = io;
};

export const getCliIo = () => currentIo;
