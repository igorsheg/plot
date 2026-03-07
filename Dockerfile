FROM oven/bun:1.3.5 AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/service/package.json packages/service/package.json
COPY packages/web/package.json packages/web/package.json
RUN bun install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/packages/*/node_modules packages/*/node_modules
COPY . .
RUN bun run typecheck
RUN bun run --filter @plot/web build

FROM base AS runtime
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/packages packages
COPY --from=build /app/package.json package.json
EXPOSE 3000
CMD ["bun", "run", "packages/service/src/main.ts"]
