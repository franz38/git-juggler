# git-juggler

## How to run locally

Dev mode (hot reload on both sides):

```
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/git-juggler <path-to-scan> --reload   # http://127.0.0.1:8000
```

```
cd src/frontend
npm install
npm run dev                                     # http://localhost:5173 (proxies /api and /ws to :8000)
```

Open http://localhost:5173 — that's the app, hot-reloading both frontend and backend.

- `<path-to-scan>` is the directory whose first-level children get scanned for git repos (e.g. `~/Documents/2026`).
- If port 8000 is unavailable on this machine (it can be occupied by unrelated local processes), run the backend with a different `--port` and update `src/frontend/vite.config.ts`'s proxy target to match — but don't commit that port change, it's a local workaround, not a project default.
- Single-port production mode (backend serves the built frontend, no Vite) is documented in `README.md`.
- Unless explicitly told otherwise, run both the backend and frontend from
  the primary checkout on the `main` branch — not from a
  `.claude/worktrees/*` copy. Worktrees exist to isolate one task's
  in-progress changes; they don't reflect what's actually landed on `main`,
  so running (or leaving running) a dev server out of one can silently show
  stale or unrelated behavior for work that's already merged.

## Architecture guideline: git mutations go through the terminal only

All UI-triggered git actions (e.g. right-click on a commit → Checkout) must be
executed via the frontend terminal (`runInTerminal` in `src/frontend/src/state/store.ts`),
not via a dedicated backend API endpoint.

- The backend only ever performs **read** operations on repos (GitPython,
  used for the commit graph, repo listing, branch/tag/stash info, etc.).
- Any action that *changes* repo state (checkout, commit, branch, stash,
  merge, reset, push, pull, ...) must be implemented as a command sent to
  that repo's terminal session, the same way checkout is.
- Do not add a backend route that shells out to `git` (or calls a mutating
  GitPython method) to perform an action on behalf of the UI.

Why: the terminal is the single point where git is actually invoked, so
there's exactly one code path to reason about for anything that mutates a
repo, and the user always sees the real command (and its real output/errors)
run for any git action, instead of a backend silently doing it.

## Testing: use the demo repo, never the user's real repos

`~/Documents/2026/demo-repo` is a disposable local git repo created
specifically for testing git-juggler — it has multiple branches
(`main`, `feature/onboarding` merged, `feature/dashboard` unmerged), a merge
commit, a tag (`v0.1.0`), and a stash, with a clean working tree.

- Always test UI actions that mutate repo state (checkout, fetch, and
  anything added later) against `demo-repo`, never against the user's real
  projects (e.g. anything under `~/Documents/2025/projects`, `fanta-bot`,
  etc.) — those have real uncommitted work and real history that must not be
  disturbed.
- It's already inside a configured scan path (`~/Documents/2026`), so it
  shows up in the app automatically — no config changes needed to use it.
- It has no remote configured on purpose. The user will connect it to GitHub
  themselves to test remote-related mechanics (fetch/push/pull against a
  real remote) — don't add a remote to it.
- If a test needs a specific extra state (dirty working tree, a particular
  conflict, more branches, etc.), set that up in `demo-repo` (or a fresh
  scratch repo elsewhere), not in a real project.

## Don't push without consensus

Never run `git push` (including to a branch, a fork, or opening a PR) until
the user has explicitly agreed to it in that conversation. Committing
locally is fine; pushing is not, until they say so.

## todo.txt: notes queue

`todo.txt` (repo root, gitignored — never commit it) is the user's plain-text
list of things to implement. It is split by a marker line:

```
--------------- IMPLEMENTED ----------------
```

- Everything **before** the marker is already implemented.
- Everything **after** the marker is still to do.

When the user asks to implement the todo list (e.g. "implement todo"):

1. Do the whole activity in a dedicated worktree (e.g. `todo`), not in the
   primary checkout: enter it before touching any code, and commit there.
   Read `todo.txt` from the primary checkout (it's gitignored, so it isn't
   present in worktrees) and take all the notes after the marker.
2. Implement them (following the rest of this file's guidelines).
3. Move the marker line down so it sits after the notes just implemented
   (i.e. those notes now live above it), leaving any not-implemented notes
   below it. Edit only the marker's position; don't rewrite the user's notes. Since `todo.txt` is
   gitignored, this edit is made on the primary checkout's copy.

If `todo.txt` doesn't exist, create it containing just the marker line.
