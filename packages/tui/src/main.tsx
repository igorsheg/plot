import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { App, type RuntimeApi } from "./app.js"

export async function runTui(options: { api: RuntimeApi }) {
  const renderer = await createCliRenderer({ exitOnCtrlC: false })
  createRoot(renderer).render(<App api={options.api} />)
  return new Promise<void>(() => {})
}

export function isTuiEntryCommand(command?: string): boolean {
  return command === "__internal-tui"
}
