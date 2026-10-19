import { useSyncExternalStore } from 'react'
import type { CutMember } from '@repo/geometry/cut-list'
import { profileQueue } from '@repo/bar-optimiser/project'
import { solveInput, type SolvedProfile } from '@repo/bar-optimiser/solve-result'
import { OPTIMISER_VERSION } from '@repo/bar-optimiser/version'
import type { ReportLanguage, ReportProgressGroup, SolveStart } from '@repo/types/reports'
import { ApiError } from '@/lib/api-client'
import { queryClient } from '@/lib/query-client'
import * as reportsApi from '@/lib/reports-api'
import { barOptimiserStatusKey, reportsKey } from '@/lib/reports-queries'
import { solvePool } from './solve-pool'
import type { SolveFailure } from './solve-messages'

// The browser's bar optimiser solves (docs/browser_solve_planing.md §4.3).
// They belong to the app, not a page (B3): the user can work anywhere in
// the workspace while they run; only closing the tab stops them, and the
// browser asks first. One solve per project. Each one: start (piece lines
// + token) → its profiles into the shared pool → progress to the server
// on every change and every 15 s as a heartbeat (B5) → the plans sent
// back → the server prints. React reads the solves with useLocalSolve(s).

/** At least this often while solving, so the server knows the tab is open
 * (the server gives up after 60 s of silence). */
const HEARTBEAT_MS = 15_000
/** Progress changes are sent at most this often. */
const PROGRESS_COALESCE_MS = 1_000

export interface LocalSolve {
  projectId: string
  lang: ReportLanguage
  state: 'starting' | 'solving' | 'sending' | 'failed'
  /** Date.now() when it started, for the elapsed timer. */
  startedAt: number
  groups: ReportProgressGroup[]
  /** When failed: a `SolveRefusal` / `SolveError` code, or `failed`. */
  error: string | null
}

interface Running {
  token: string
  heartbeat: ReturnType<typeof setInterval>
  progressTimer: ReturnType<typeof setTimeout> | null
  /** Profiles running now, per member group, last started last. */
  active: Map<CutMember, string[]>
}

let solves: ReadonlyMap<string, LocalSolve> = new Map()
const running = new Map<string, Running>()
const listeners = new Set<() => void>()

function set(projectId: string, solve: LocalSolve | null): void {
  const next = new Map(solves)
  if (solve) next.set(projectId, solve)
  else next.delete(projectId)
  solves = next
  listeners.forEach((listener) => listener())
}

function patch(projectId: string, changes: Partial<LocalSolve>): void {
  const current = solves.get(projectId)
  if (current) set(projectId, { ...current, ...changes })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Every solve this tab is making or has failed, by project. */
export function useLocalSolves(): ReadonlyMap<string, LocalSolve> {
  return useSyncExternalStore(subscribe, () => solves)
}

export function useLocalSolve(projectId: string | undefined): LocalSolve | undefined {
  const all = useLocalSolves()
  return projectId ? all.get(projectId) : undefined
}

function isBusy(solve: LocalSolve): boolean {
  return solve.state !== 'failed'
}

/** Generate (docs/browser_solve_planing.md §3). Does nothing while this
 * tab is already making the project's report. */
export async function startSolve(projectId: string, lang: ReportLanguage): Promise<void> {
  const existing = solves.get(projectId)
  if (existing && isBusy(existing)) return
  watchUnload()
  set(projectId, { projectId, lang, state: 'starting', startedAt: Date.now(), groups: [], error: null })

  let start: SolveStart
  try {
    start = await reportsApi.startBarOptimiserSolve(projectId, lang, OPTIMISER_VERSION)
  } catch (error) {
    patch(projectId, { state: 'failed', error: codeOf(error) })
    refresh(projectId)
    return
  }
  queryClient.setQueryData(barOptimiserStatusKey(projectId, lang), start.status)
  patch(projectId, { state: 'solving', groups: start.status.solve?.groups ?? [] })

  const queue = profileQueue(
    solveInput(start.lines.map((line) => ({ ...line, member: line.member as CutMember }))),
  )
  const results = new Map<string, SolvedProfile>()
  const run: Running = {
    token: start.token,
    heartbeat: setInterval(() => void sendProgress(projectId), HEARTBEAT_MS),
    progressTimer: null,
    active: new Map(),
  }
  running.set(projectId, run)
  if (!queue.length) return void finish(projectId, lang, [])

  solvePool.submit(
    projectId,
    queue.map(({ profile, member, list }) => ({
      profile,
      list,
      settings: start.settings,
      onStart: () => {
        run.active.set(member, [...(run.active.get(member) ?? []), profile])
        updateGroup(projectId, member, (g) => ({
          ...g,
          state: 'running',
          currentProfile: start.profileNos[profile] ?? profile,
        }))
      },
      onDone: (result) => {
        results.set(profile, result)
        const left = (run.active.get(member) ?? []).filter((p) => p !== profile)
        run.active.set(member, left)
        const latest = left.at(-1)
        updateGroup(projectId, member, (g) => {
          const done = g.profilesDone + 1
          return {
            ...g,
            profilesDone: done,
            state: done >= g.profilesTotal ? 'done' : 'running',
            currentProfile: latest ? (start.profileNos[latest] ?? latest) : null,
          }
        })
        if (results.size === queue.length) {
          void finish(
            projectId,
            lang,
            queue.map((q) => results.get(q.profile)!),
          )
        }
      },
      onError: (error) => void fail(projectId, lang, error),
    })),
  )
}

/** Stop (B6): this tab's solve ends; the last good report stays. */
export async function stopSolve(projectId: string): Promise<void> {
  const solve = solves.get(projectId)
  const run = end(projectId)
  set(projectId, null)
  if (solve && run) {
    await reportsApi.stopSolve(projectId, solve.lang, { token: run.token }).catch(() => undefined)
  }
  refresh(projectId)
}

/** Clears a failed solve's message. */
export function dismissSolve(projectId: string): void {
  if (solves.get(projectId)?.state === 'failed') set(projectId, null)
}

function updateGroup(
  projectId: string,
  member: CutMember,
  change: (group: ReportProgressGroup) => ReportProgressGroup,
): void {
  const solve = solves.get(projectId)
  if (!solve) return
  patch(projectId, { groups: solve.groups.map((g) => (g.member === member ? change(g) : g)) })
  const run = running.get(projectId)
  if (run && !run.progressTimer) {
    run.progressTimer = setTimeout(() => {
      run.progressTimer = null
      void sendProgress(projectId)
    }, PROGRESS_COALESCE_MS)
  }
}

async function sendProgress(projectId: string): Promise<void> {
  const solve = solves.get(projectId)
  const run = running.get(projectId)
  if (!solve || !run || solve.state !== 'solving') return
  try {
    await reportsApi.sendSolveProgress(projectId, run.token, solve.groups)
  } catch (error) {
    // Someone took the solve over after this tab went quiet: stop here.
    if (codeOf(error) === 'solve_lost') {
      end(projectId)
      patch(projectId, { state: 'failed', error: 'solve_lost' })
      refresh(projectId)
    }
  }
}

async function finish(projectId: string, lang: ReportLanguage, profiles: SolvedProfile[]): Promise<void> {
  const run = running.get(projectId)
  if (!run) return
  if (run.progressTimer) clearTimeout(run.progressTimer)
  run.progressTimer = null
  patch(projectId, { state: 'sending' })
  try {
    const status = await reportsApi.sendSolveResult(projectId, lang, {
      token: run.token,
      optimiserVersion: OPTIMISER_VERSION,
      profiles,
    })
    end(projectId)
    set(projectId, null)
    queryClient.setQueryData(barOptimiserStatusKey(projectId, lang), status)
  } catch (error) {
    end(projectId)
    patch(projectId, { state: 'failed', error: codeOf(error) })
  }
  refresh(projectId)
}

/** A worker gave up (B11): the whole report fails, and the server is told
 * why so everyone sees it. */
async function fail(projectId: string, lang: ReportLanguage, error: SolveFailure): Promise<void> {
  const run = end(projectId)
  if (!run) return
  patch(projectId, { state: 'failed', error })
  await reportsApi.stopSolve(projectId, lang, { token: run.token, error }).catch(() => undefined)
  refresh(projectId)
}

/** Stops the workers and timers; returns what was running. */
function end(projectId: string): Running | undefined {
  const run = running.get(projectId)
  if (!run) return undefined
  solvePool.stop(projectId)
  clearInterval(run.heartbeat)
  if (run.progressTimer) clearTimeout(run.progressTimer)
  running.delete(projectId)
  return run
}

function refresh(projectId: string): void {
  void queryClient.invalidateQueries({ queryKey: [...reportsKey, 'bar-optimiser', projectId] })
}

/** The API's `code` (a SolveRefusal), else `failed`. */
function codeOf(error: unknown): string {
  if (error instanceof ApiError && error.body && typeof error.body === 'object' && 'code' in error.body) {
    const code = (error.body as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return 'failed'
}

let watching = false
/** "Leave site?" while a solve runs (B3): closing the tab stops it. */
function watchUnload(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  window.addEventListener('beforeunload', (event) => {
    if ([...solves.values()].some(isBusy)) event.preventDefault()
  })
}
