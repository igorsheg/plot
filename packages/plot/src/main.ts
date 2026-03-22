import { runServerMain } from "./server-main.js";

await runServerMain(process.env as Record<string, string | undefined>);
