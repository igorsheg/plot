import { createRootRoute, Outlet } from "@tanstack/react-router"
import "@/app.css"

export const Route = createRootRoute({
  component: () => <Outlet />,
})
