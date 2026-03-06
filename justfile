# list available recipes
default:
    @just --list

# install dependencies
install:
    bun install

# start server and web dev in parallel
dev:
    bunx concurrently -n server,web -c blue,magenta "bun run dev:server" "bun run dev:web"

# start only the backend server (watch mode)
dev-server:
    bun run dev:server

# start only the web frontend (vite)
dev-web:
    bun run dev:web

# run all checks: typecheck, lint, format
check:
    bun run typecheck
    bun run lint
    bun run fmt:check

# typecheck all packages
typecheck:
    bun run typecheck

# lint with oxlint
lint:
    bun run lint

# lint and auto-fix
lint-fix:
    bun run lint:fix

# check formatting with oxfmt
fmt-check:
    bun run fmt:check

# format all files
fmt:
    bun run fmt

# run tests
test *args:
    bun test {{ args }}

# build all packages
build:
    bun run build

# add a coss ui component (e.g. just ui-add button)
ui-add component:
    bunx shadcn@latest add @coss/{{ component }} --cwd packages/web --yes

# run plot CLI (default: TUI, or pass subcommand e.g. `just plot serve`)
plot *args:
    bun run packages/cli/src/index.ts {{ args }}

# clean build artifacts and node_modules
clean:
    rm -rf packages/*/dist packages/*/node_modules node_modules
