# Project: Multi-tenant SaaS for Aluminium Window Manufacturers

## What this is
A multi-tenant SaaS platform built specifically for aluminium window
manufacturers. It helps them design windows, generate the associated
paperwork (quotes, specs, work orders, etc.), and manage their projects
end to end. This is a domain-specific tool for the window-manufacturing
workflow — NOT a general-purpose CRM like Odoo. Keep features focused on
the manufacturer's real workflow (design → paperwork → project delivery)
rather than generic CRM breadth.

Each company (tenant) is a manufacturer and gets isolated data via its own
Postgres schema.

## Scale constraints (design for these, don't over-engineer past them)
- Max 5 users per company
- Max 250 companies total
- This architecture comfortably handles that ceiling on a single Postgres
  instance — no sharding, no read replicas needed at this scale.

## Tech stack
- **Backend:** NestJS + TypeScript + TypeORM
- **Frontend:** React + TypeScript + Vite
  - TanStack Query (server state), TanStack Table + dnd-kit (kanban/tables)
  - shadcn/ui (components), React Hook Form + Zod (forms)
- **Monorepo:** Turborepo — `apps/api`, `apps/web`, `packages/types` (shared
  TS types between frontend and backend)
- **Databases:** PostgreSQL (shared control-plane DB + per-tenant schemas)
- **Cache/queue:** Redis + BullMQ (background jobs: provisioning, email, reports)
- **Hosting:** DigitalOcean App Platform + Managed Postgres + Managed Redis

## Multi-tenancy model — READ THIS BEFORE TOUCHING AUTH OR DB CODE
- **Single domain**, not subdomain-based. Everyone hits `www.example.com`.
  There is no tenant context until a user logs in.
- **Shared database** (control plane) holds: `users`, `companies`, `billing`.
  This is the ONLY place user credentials and company/billing metadata live.
- **Per-tenant Postgres schema** holds each manufacturer's actual business
  data: projects, window designs, paperwork (quotes/specs/work orders),
  customers, etc. One schema per company.
- **Login flow:** user submits email/password → backend checks the shared
  `users` table → on success, issues a JWT containing a `company_id` /
  schema claim → that claim rides along on every subsequent request.
- **TenantConnectionService:** a request-scoped service that reads the JWT's
  tenant claim and sets the Postgres `search_path` (or picks/creates the
  right TypeORM `DataSource`) for that request. ALL tenant-schema queries
  must go through this — never hardcode a schema name.
- Never let tenant data queries run without a resolved tenant context.
  A missing or wrong tenant claim should fail closed, not default to any
  schema.

## Development phases (build in this order)
1. **Local foundation** — Turborepo skeleton, Docker Compose (Postgres + Redis)
2. **Backend skeleton** — shared DB schema + migration, auth module (signup/
   login, JWT issuance), TenantConnectionService, one protected dummy
   endpoint (`GET /me`) proving auth + tenant scoping both work
3. **Frontend skeleton** — landing/login page, auth state, protected routes,
   call the dummy endpoint to prove the full loop end-to-end
4. **First real feature** — `projects` table inside tenant schema, basic CRUD.
   This is the natural first domain entity; window designs and paperwork build
   on top of a project.
5. **Deploy early** — push the skeleton to DigitalOcean before it's feature-
   complete, to validate hosting/env config early

Do not build the window designer, paperwork generation, or invites before
steps 2-4 are proven end-to-end. The tenant-resolution plumbing is the
riskiest part — validate it first with throwaway endpoints before building
real features on top of it.

## Domain notes (fill in as the workflow gets defined)
The core workflow is: design a window → generate paperwork from that design →
manage it within a project. Key domain concepts to model later: window
designs (dimensions, profiles, glass types, hardware), paperwork/documents
(quotes, specs, work orders), and how they attach to projects and customers.
Keep this section updated as the manufacturing workflow gets nailed down.

## Conventions

### Branching and releases
- `main` is a snapshot of the last release cut — no direct pushes,
  no PRs merge into it directly.
- `dev` is where day-to-day work lands. All feature branches branch off
  `dev` and PR back into it.
- Branch names: `feature/<short-description>`, `fix/<short-description>`,
  `chore/<short-description>` (e.g. `feature/tenant-connection-service`).
- A release is a merge of `dev` into `main`, tagged (`vX.Y.Z`). That merge
  is what triggers the production deploy (Phase 10 of
  `docs/initial_plan.md`) — never deploy off `dev` directly.

### Commits and PRs
- Commit messages: `<type>: <short description>` — `feat`, `fix`, `chore`,
  `docs`, `refactor`, `test`. Body explains *why* when it's not obvious
  from the diff.
- Every PR uses `.github/PULL_REQUEST_TEMPLATE.md` (what changed, why,
  how it was verified) and targets `dev`.

### Testing approach
(Fill in once the backend test harness exists — Phase 3 of
`docs/initial_plan.md`.)

### API reference (Postman)
`apps/api/postman/Aluminia.postman_collection.json` documents every HTTP
endpoint in `apps/api` — method, path, auth/role requirement, and the
exact request body per its Zod schema in `packages/types`. It's
gitignored (local reference only, not shared via git), so it doesn't
ride along with commits automatically. **Whenever a route is added,
removed, or its request/response shape changes in
`apps/api/src/modules/**/*.controller.ts`, update this collection too**
— a stale collection is worse than no collection. New routes get a
request in the matching folder (or a new folder, matching the
controller); removed routes get their request deleted; changed schemas
get their example body and description updated to match.
