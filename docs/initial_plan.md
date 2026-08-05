# Development Plan

Follow this plan in order, top to bottom. Check off each item as it's
completed. Don't skip ahead to a later phase until the current one is
proven working. Refer to CLAUDE.md for the architectural rules
(multi-tenancy model, tech stack, scale constraints) behind every step.

**Ordering principle:** the tenant-resolution plumbing is the riskiest
part of this system, so it gets proven with seeded data and hand-minted
JWTs *before* real auth is built on top of it. Auth is well-understood
work; tenant isolation is where a mistake leaks one manufacturer's data
into another's. De-risk the unknown first.

---

## Decisions locked in

These were decided up front. Don't re-litigate them mid-build; if one
turns out wrong, change it here first, then in the code.

| Area | Decision |
| --- | --- |
| **Onboarding** | No public signup. A **super admin** (platform owner) creates each company, sets its subscription and `max_users` seat limit, and creates that company's first **company admin**. The company admin then adds users up to the seat limit. |
| **Roles** | Three: `super_admin` (platform-level, belongs to no company), `company_admin` (manages users within one company), `user` (regular member of one company). |
| **Provisioning** | Synchronous and transactional. Creating a company creates its row, its Postgres schema, and runs the tenant migrations in one transaction. No BullMQ for provisioning — at 250 companies this runs rarely. Redis/BullMQ stays reserved for email and reports. |
| **Tokens** | Short-lived access JWT + long-lived refresh token, with rotation. Refresh tokens are tracked server-side so they can be revoked. |
| **Sessions** | One active session per user. Logging in somewhere new invalidates the previous session. (See open question below.) |
| **Git flow** | Feature branches → PR into `dev`. Release cut = merge `dev` → `main`, tagged as a release. Deploy fires on merge to `main`. |

### Open question to confirm before Phase 7

The session rule was stated as "single session … can't reuse this user on
more than 2 machines or tabs". Those are two different rules. The plan
below assumes **strictly one active session per user** (a new login kills
the old one). If the intent was actually "up to 2 concurrent devices",
say so — it changes the session table from one row per user to a capped
list, and changes what happens on the 3rd login (reject vs. evict oldest).

---

## Engineering standards (apply to every phase)

These are the "clean and modular" rules. They're cheap to follow from the
start and expensive to retrofit.

- **One concern per module.** A Nest module owns its controller, service,
  entities, and DTOs. Modules talk to each other through injected
  services, never by reaching into another module's repositories.
- **No business logic in controllers.** Controllers parse/validate input
  and delegate. Services hold the logic. Repositories hold the queries.
- **Validate at the edge.** Every request body/query gets a DTO with
  validation. Nothing untyped reaches a service.
- **Share contracts, not implementations.** Request/response shapes that
  both apps need live in `packages/types`. No backend internals leak into
  that package.
- **Tenant queries go through `TenantConnectionService`.** Never hardcode
  or string-interpolate a schema name. A missing/invalid tenant claim
  fails closed — never falls back to a default schema.
- **Migrations only.** No `synchronize: true`, in any environment. Schema
  changes ship as reviewed migration files.
- **Secrets from validated env.** No literals, no `process.env` reads
  scattered through the code — one typed, validated config module.
- **Tests where correctness isn't obvious**: tenant isolation, seat
  limits, auth guards, token rotation. Not every getter.

### Target backend structure

Build toward this; don't create empty folders ahead of need.

```
apps/api/src/
  main.ts
  app.module.ts
  config/               # env schema + typed config service
  common/               # guards, filters, interceptors, decorators, pipes
  database/
    control-plane/      # shared DB datasource + its migrations
    tenant/             # tenant datasource factory + tenant migrations
  modules/
    health/
    tenancy/            # TenantConnectionService, provisioning, request context
    auth/               # login, refresh, logout, guards, strategies
    users/
    companies/
    projects/
    lookups/
```

---

## Phase 0 — Prerequisites (manual, one-time)
- [x] Node.js 18+ and npm installed
- [x] Docker installed and running
- [x] Git installed, repo initialized

## Phase 1 — Local Foundation
- [x] Bootstrap the Turborepo monorepo (`npx create-turbo@latest`)
- [x] Scaffold `apps/api` with NestJS
- [x] Scaffold `apps/web` with React + TypeScript + Vite
- [x] Create `packages/types` as a shared TypeScript package (own
      `package.json`, `tsconfig.json`, `src/index.ts`)
- [x] Add `@repo/types` as a dependency in both `apps/api` and `apps/web`
      via the npm workspace
- [x] Run `npm install` from the repo root, confirm the workspace symlink
      to `packages/types` actually exists in `node_modules`
- [x] Add `docker-compose.yml` for local Postgres + Redis
- [x] Run `docker-compose up`, confirm both services are reachable
- [x] Confirm `CLAUDE.md` is present at the repo root

## Phase 2 — Repo Hygiene & Branch Workflow
Do this before writing feature code — every phase below ships as a PR into
`dev`, so the workflow has to exist first.

- [x] Remove the nested git repo at `apps/api/.git` (left behind by
      `nest new`). While it exists, `apps/api` is a repo-inside-a-repo and
      the parent can't track its contents properly. Had zero commits, so
      nothing was lost.
- [x] Decide whether `docs/` and `CLAUDE.md` stay gitignored. Un-ignored
      both — they're project documentation, not secrets.
- [x] Make the initial commit of the working skeleton (root commit
      `078c16c`, 107 files — Turborepo skeleton, docker-compose, and the
      full landing page)
- [x] Create the `dev` branch — currently the local working branch.
      "Default branch" (in the GitHub sense) is pending the remote below.
- [x] Confirm the remote exists and both branches are pushed — `origin`
      is `https://github.com/mariohany/Aluminia-web.git`; `main` and `dev`
      are both pushed and tracking
- ~~Protect `main` with branch-protection rules~~ — skipped by choice.
  Solo project, not worth the overhead; `main` stays protected by
  convention (only ever updated via `dev` → `main` merges at release time)
  rather than a GitHub-enforced rule.
- [x] Add a PR template (what changed / why / how it was verified) —
      `.github/PULL_REQUEST_TEMPLATE.md`
- [x] Record commit-message and branch-naming conventions in the
      Conventions section of CLAUDE.md — done (branch is `main`, not
      `master`, matching the repo's actual default branch name)

## Phase 3 — Backend Foundations
No domain logic yet — this is the plumbing every later phase assumes.

- [ ] Add a typed config module with schema-validated env vars (fail fast
      and loudly at boot on a missing/invalid var, never silently at first use)
- [ ] Add `.env.example` documenting every required var; keep real `.env`
      files gitignored
- [ ] Install and wire TypeORM + `pg`; connect to the control-plane DB
- [ ] Set up migration infrastructure: CLI datasource, `migration:generate`
      / `migration:run` / `migration:revert` scripts. `synchronize` stays
      off everywhere.
- [ ] Add a global validation pipe, global exception filter (consistent
      error shape), and request-scoped structured logging with a request id
- [ ] Configure CORS for the web app's origin, plus security headers
- [ ] Add `GET /health` — checks DB and Redis connectivity. The deploy
      platform needs this later; having it now makes Phase 10 boring.
- [ ] Add the API test setup (unit + e2e harness, test DB config)

**Proves:** the API boots, connects, migrates, and reports its own health.

## Phase 4 — Control-Plane Schema
The shared DB only. This is the single source of truth for identity and
billing — no manufacturer business data ever lands here.

- [ ] `companies` — name, status, subscription/plan, `max_users` seat
      limit, `schema_name`, timestamps
- [ ] `users` — email (unique), password hash, `role`
      (`super_admin` | `company_admin` | `user`), nullable `company_id`
      (null for super admins), status, timestamps
- [ ] `billing` — subscription state per company, structured so plan
      changes are auditable rather than overwritten in place
- [ ] `sessions` (or `refresh_tokens`) — server-side record backing refresh
      rotation and the one-active-session rule
- [ ] Write the migration; run it; verify the tables against a fresh DB
- [ ] Add DB constraints that encode the rules: unique email, FK
      `users.company_id → companies.id`, and a check that a `super_admin`
      has no `company_id` while other roles must have one

**Proves:** identity and tenancy metadata have a correct, constrained home.

## Phase 5 — Tenant Provisioning & Tenant Migrations
The riskiest phase. No HTTP yet — this is all service-level and
script-driven so it can be proven in isolation.

- [ ] Define the tenant migration track, kept entirely separate from the
      control-plane track (different folder, different runner). Confusing
      the two is the classic way to corrupt a multi-tenant DB.
- [ ] Build `TenantProvisioningService.provision(company)`: creates the
      company row, `CREATE SCHEMA`, and runs all tenant migrations —
      atomically. If any step fails, no half-provisioned tenant survives.
- [ ] Derive `schema_name` safely (never from raw user input; validate
      against a strict pattern before it reaches SQL)
- [ ] Build a "migrate all tenants" runner that applies pending tenant
      migrations across every company schema, and reports per-schema
      results. This is how every future tenant schema change ships.
- [ ] Add a seed script creating a super admin plus **two** companies, each
      with its own admin and distinguishable data. Two tenants is the
      minimum needed to prove isolation.
- [ ] Test: provision a company, assert the schema exists with the expected
      tables; assert a failed provision leaves nothing behind

**Proves:** a new manufacturer gets a correct, isolated, fully-migrated
schema — and a failure leaves no mess.

## Phase 6 — Tenant Resolution (the isolation guarantee)
Still no real auth. Hand-mint JWTs so tenant resolution is tested on its
own, exactly as CLAUDE.md advises.

- [ ] Build the request-scoped tenant context: read the tenant claim,
      resolve it to a real company, expose it to the request
- [ ] Build `TenantConnectionService`: resolves the right connection /
      `search_path` for the request's tenant
- [ ] Fail closed on every bad path: no claim, unknown company, inactive
      company, or a claim the user isn't entitled to → reject. Never
      default to a schema.
- [ ] Ensure connection cleanup — a pooled connection must never carry one
      tenant's `search_path` into the next request
- [ ] Add a temporary endpoint that returns tenant-scoped data
- [ ] **Isolation test:** call it with tenant A's and tenant B's tokens,
      assert each sees only its own rows; assert a missing/garbage/unknown
      tenant claim is rejected rather than served

**Proves:** the core multi-tenancy guarantee, before anything depends on it.

## Phase 7 — Auth
- [ ] Password hashing (argon2 preferred, bcrypt acceptable) behind a
      small service, so the algorithm can change in one place
- [ ] `POST /auth/login` — verify credentials against the control-plane
      `users` table, reject inactive users and inactive companies
- [ ] Issue a short-lived access JWT carrying user id, role, and the
      `company_id` / schema claim (super admins carry no tenant claim)
- [ ] Issue a refresh token, stored server-side, sent as an httpOnly
      cookie; rotate on every refresh and detect reuse of a retired token
- [ ] Enforce one active session per user — a new login invalidates the
      previous session (pending the open question above)
- [ ] `POST /auth/refresh` and `POST /auth/logout`
- [ ] Auth guard + role guard, applied globally with an explicit
      opt-out decorator for public routes — so a new endpoint is protected
      by default, not by remembering to protect it
- [ ] `GET /me` — returns the authenticated user, their role, and their
      company, resolved through the real tenant context
- [ ] Tests: valid/invalid login, expired access token, refresh rotation,
      reuse of a revoked token, second login killing the first session,
      role guard blocking a `user` from `company_admin` routes

**Proves:** the full auth → tenant-scoped response loop, server-side.

## Phase 8 — Frontend Skeleton
- [ ] Set up routing, TanStack Query, and the shadcn/ui + Tailwind baseline
- [ ] Build the guest/landing page (no tenant context — same for everyone)
- [ ] Build the login form with React Hook Form + Zod, sharing request
      types from `packages/types`
- [ ] Handle tokens: keep the access token in memory, let the refresh
      cookie do the persistence, and refresh transparently on 401
- [ ] Protected route wrapper + role-aware routing; redirect to login on
      an unrecoverable 401
- [ ] Call `GET /me` and render it
- [ ] Handle the states real users hit: loading, wrong password, expired
      session, server down

**Proves:** browser → login → shared DB → tenant context → scoped response.

## Phase 9 — Admin APIs & UI
Now that the loop is proven, build the real way tenants and users are created.

- [ ] Super-admin endpoints: create a company (subscription + `max_users`),
      provision its schema via Phase 5's service, create its first company
      admin, and activate/suspend a company
- [ ] Company-admin endpoints: list, invite/create, deactivate users
      within their own company only
- [ ] **Enforce the seat limit server-side**, in the same transaction as
      user creation, so concurrent requests can't both slip past the cap.
      A client-side check alone is not enforcement.
- [ ] Guard every admin route by role, and scope company-admin routes to
      the caller's own company — a company admin must not be able to touch
      another company by passing its id
- [ ] Minimal super-admin UI (companies + seats) and company-admin UI (users)
- [ ] Tests: seat limit at the boundary and under concurrency,
      cross-company access attempts rejected, role escalation attempts rejected

## Phase 10 — CI/CD & First Deploy
Deploy while the app is still small enough that hosting problems are
obvious. Per the decision above, deploys are driven by the branch flow.

- [ ] CI on every PR into `dev`: install, lint, type-check, build, test
      (Turborepo caching keeps this fast)
- [ ] Provision DigitalOcean Managed Postgres + Managed Redis
- [ ] Deploy `apps/api` and `apps/web` to DigitalOcean App Platform
- [ ] Configure production env vars / connection strings as secrets — never
      committed
- [ ] Run control-plane migrations on deploy as an explicit, gated step —
      not silently at app boot, where a rollback becomes a scramble
- [ ] Wire the release flow: merge `dev` → `main` triggers the production
      deploy and cuts a tagged release
- [ ] Point the platform's health check at `GET /health`
- [ ] Verify login → `/me` works in production, not just locally
- [ ] Document rollback: how to revert a bad release and its migration

## Phase 11 — First Real Feature: Projects
- [ ] Add a `projects` table to the **tenant** migration track; run it
      across all existing schemas with Phase 5's runner
- [ ] Projects module: CRUD, every query routed through
      `TenantConnectionService`
- [ ] Share request/response types via `packages/types`
- [ ] Projects list + create UI with TanStack Query
- [ ] Test: tenant A cannot read, update, or delete tenant B's project by
      guessing its id

**Proves:** the tenant plumbing carries a real domain entity end to end.

## Phase 12 — Shared Lookup Data
- [ ] Add `lookup_values` and `lookup_meta` (with a `version` column) to
      the shared DB
- [ ] Build `LookupsService` using the Redis cache-aside pattern, keyed by
      `lookups:v{version}`
- [ ] Bump `lookup_meta.version` in the same transaction as any write to
      `lookup_values`, so a failed write can't leave a stale cache key live
- [ ] Expose `GET /lookups`; cache client-side with TanStack Query
      (`staleTime: Infinity`)

---

## Not yet — hold off until the above is solid
Window design tooling and paperwork generation (quotes, specs, work
orders) are the core product value, but they build on top of the
projects/tenant plumbing above. Don't start them until Phase 11 is proven
end to end.

When they do start, the domain modelling questions to answer first are in
the Domain notes section of CLAUDE.md — window designs (dimensions,
profiles, glass types, hardware), documents (quotes, specs, work orders),
and how they attach to projects and customers. Fill that section in as the
manufacturing workflow gets nailed down; it's the input to that phase.
