# git-juggler

## Architecture guideline: git mutations go through the terminal only

All UI-triggered git actions (e.g. right-click on a commit → Checkout) must be
executed via the frontend terminal (`runInTerminal` in `frontend/src/state/store.ts`),
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
