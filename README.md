# Aluminia

## The story

Aluminium window and façade manufacturers run on the same broken loop:
someone designs a window, then re-types its dimensions into a quote,
re-types them again into a spec sheet, and again into a work order for
the workshop — and somewhere in all that re-typing, a number quietly
changes. Aluminia exists to break that loop. Design the window once, and
the quote, the spec sheet, and the work order are all generated straight
from that one design, following the job from first enquiry through to
delivery.

It's a **multi-tenant SaaS**, not a generic CRM — it doesn't try to be
Odoo. It's purpose-built for one workflow: **design → paperwork →
project**. Each manufacturer (tenant) gets its own isolated slice of data
inside a shared platform: a single company creates the account, invites
its own team (capped at 5 users), and everything they design and produce
stays walled off from every other company on the platform — up to a
ceiling of 250 companies, by design, not as a limitation to work around.

The project is early: the tenant-isolation plumbing and the public
landing page are built and verified; the window designer and paperwork
generation are the next real chapters. See
[`docs/initial_plan.md`](docs/initial_plan.md) for the backend build
order and [`docs/landing_planing.md`](docs/landing_planing.md) for the
landing page, and [`CLAUDE.md`](CLAUDE.md) for the full architecture
rules.

## Modules and technologies

A Turborepo monorepo, `npm` workspaces, 100% TypeScript.

```
apps/
  api/            NestJS backend
  web/            React frontend (landing page today; the app itself later)
packages/
  types/          Shared TypeScript types & Zod schemas (used by both apps)
  ui/             Shared shadcn/ui-based component library
  eslint-config/  Shared ESLint configs
  typescript-config/  Shared tsconfig bases
```

**Backend (`apps/api`)**
- [NestJS](https://nestjs.com/) — application framework
- [TypeORM](https://typeorm.io/) + `pg` — Postgres access; a shared
  control-plane database (users, companies, billing) plus one Postgres
  **schema per tenant** for each manufacturer's own data
- [Zod](https://zod.dev/) — env config validation and request validation
  (via `nestjs-zod`), shared schemas live in `packages/types`
- [`nestjs-pino`](https://github.com/iamolegga/nestjs-pino) — structured,
  request-scoped JSON logging
- [`@nestjs/terminus`](https://docs.nestjs.com/recipes/terminus) —
  health checks (Postgres + Redis)
- `ioredis` + [BullMQ](https://bullmq.io/) (planned) — Redis-backed
  background jobs (provisioning, email, reports)
- `helmet` — security headers

**Frontend (`apps/web`)**
- [React 19](https://react.dev/) + [Vite](https://vite.dev/)
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
  (Radix primitives)
- [React Router](https://reactrouter.com/)
- [`react-i18next`](https://react.i18next.com/) — full English/Arabic
  support with right-to-left layout, built in from the start
- [TanStack Query](https://tanstack.com/query) (server state, as the app
  grows) and [React Hook Form](https://react-hook-form.com/) + Zod (forms)

**Infrastructure**
- [Docker Compose](docker-compose.yml) — local Postgres 16 + Redis 7
- DigitalOcean App Platform + Managed Postgres + Managed Redis (planned
  production target)

## Running it locally

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [npm](https://www.npmjs.com/) (this repo uses npm workspaces — not pnpm
  or yarn)
- [Docker](https://www.docker.com/) (Docker Desktop or equivalent), for
  local Postgres and Redis

### 1. Install dependencies

From the repo root — this installs every app and package in the
workspace in one go:

```sh
npm install
```

### 2. Start Postgres and Redis

```sh
docker compose up -d
```

This starts Postgres 16 on `localhost:5432` and Redis 7 on
`localhost:6379`, matching the defaults the API expects.

### 3. Configure the API's environment

```sh
cp apps/api/.env.example apps/api/.env
```

The defaults in `.env.example` already match the `docker-compose.yml`
services, so no edits are needed for local development. See
[`apps/api/src/config/env.schema.ts`](apps/api/src/config/env.schema.ts)
for what each variable does — every one is validated at boot, and the
API fails fast with a clear error if any is missing or malformed.

### 4. Run everything

From the repo root, via [Turborepo](https://turborepo.dev/):

```sh
npm run dev
```

This runs `apps/api` and `apps/web` in parallel:

- API: [http://localhost:3000](http://localhost:3000) —
  `GET /health` reports Postgres/Redis connectivity
- Web: [http://localhost:5173](http://localhost:5173)

To run just one app: `npm run dev --workspace=apps/api` (or
`apps/web`).

### Other useful commands

Run from the repo root unless noted:

```sh
npm run build          # build every app and package
npm run lint            # lint everything
npm run check-types     # type-check everything
```

From `apps/api`, for database migrations (never run `synchronize` —
schema changes always go through a migration):

```sh
npm run migration:generate -- src/database/control-plane/migrations/MigrationName
npm run migration:run
npm run migration:revert
```

## Conventions

Branching, commit style, and how work moves from a feature branch into
`dev` and eventually `main` are documented in
[`CLAUDE.md`](CLAUDE.md#conventions).
