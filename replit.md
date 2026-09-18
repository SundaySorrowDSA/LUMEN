# Lumen — Personal AI Assistant

Lumen is a personal AI workspace that keeps one assistant personality across conversations, memory, model routing, and permissioned actions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/personal-ai-assistant` — the responsive assistant workspace
- `artifacts/api-server/src/routes/assistant.ts` — assistant API and preview-mode reply behavior
- `lib/assistant-providers/src/index.ts` — provider-neutral model contract, registry, and router
- `lib/api-spec/openapi.yaml` — source of truth for assistant API contracts
- `lib/db/src/schema/assistant.ts` — conversations, messages, and memory tables
- `artifacts/personal-ai-assistant/src/index.css` — shared visual theme

## Architecture decisions

- The first build is intentionally provider-neutral and exposes the active model route in the UI.
- Provider credentials are never stored in PostgreSQL; each provider has independent secret names and runtime-only readiness checks.
- The router always has a no-key local preview provider and can accept separate Kindroid, OpenAI, Anthropic/Claude, or future adapters without making one provider primary.
- The live Kindroid adapter uses only `KINDROID_API_KEY` and `KINDROID_AI_ID` from Replit Secrets and calls Kindroid's official `/v1/send-message` endpoint with a non-streaming request.
- External capabilities are represented as permissioned connection states instead of silently implying access.
- Conversation and memory data are persisted in PostgreSQL; the workspace seeds a small starter context on first load.

## Product

- One consistent assistant workspace with conversation history and a visible routing status.
- Saved memory entries that can be added or removed by the user.
- A connections view for memory, web research, workspace services, and permissioned actions.
- An independent model-provider catalog with safe readiness status and active-route selection.
- Preview-mode responses that preserve user messages until a live model provider is connected.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
