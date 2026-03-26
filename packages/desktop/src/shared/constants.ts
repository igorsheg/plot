import path from "node:path";
import os from "node:os";

export const CONFIG_DIR = path.join(os.homedir(), ".plot", "desktop");
export const PROJECTS_FILE = path.join(CONFIG_DIR, "projects.json");
export const DEFAULT_PORT_START = 4100;
export const HEALTH_POLL_INTERVAL_MS = 2000;
export const HEALTH_POLL_TIMEOUT_MS = 15_000;
export const DEV_VIEW_PORT = 5174;
