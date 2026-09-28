<img src="https://github.com/franz38/git-juggler/blob/main/src/frontend/public/logo.png?raw=true" alt="git-juggler" width="400">

A local Git dashboard for people juggling agents and too many repos.

Watch agents work live, follow every repo’s git graph, and catch what changed across your workspace — all from one place, without opening a dozen editors.

<img src="https://github.com/franz38/git-juggler/blob/main/resources/git-juggler-demo-1.gif?raw=true" alt="git-juggler" width="100%">

<img src="https://github.com/franz38/git-juggler/blob/main/resources/git-juggler-demo-4.png?raw=true" alt="git-juggler" width="100%">

## What it does

- Scans the immediate children of one or more configured folders for Git repos.
- Lets you inspect and manage each repo's graph, branches, tags, stashes, dirty files, and file diffs.
- Keeps a persistent terminal per open repo and runs Git actions there so you see the real commands and output.
- Tracks local Claude Code and OpenCode sessions.
- Connects GitHub Actions and Jenkins runs to commits and active pipelines.
- VS Code-compatible themes.

## How to install

git-juggler is published on PyPI. The recommended way to install it is with
[pipx](https://pipx.pypa.io), which puts the `git-juggler` command on your
PATH in its own isolated environment, without touching your system Python:

```
pipx install git-juggler
git-juggler [path-to-scan] [--host HOST] [--port PORT] [--no-open]
```

`<path-to-scan>` is optional and defaults to the current directory. It is used
to seed the initial search path; after that, search paths are managed in the app
from the welcome wizard or Settings.

- `--host HOST` changes the bind host from the default `127.0.0.1`.
- `--port PORT` changes the backend port from the default `8000`.
- `--no-open` disables opening the app in your browser automatically.

If you don't have pipx yet:

**macOS**
```
brew install pipx
pipx ensurepath
```

**Linux**
```
sudo apt install pipx   # Debian/Ubuntu
sudo dnf install pipx   # Fedora
pipx ensurepath
```
Many recent distros (like macOS with Homebrew) block a plain global
`pip install` outside a virtual environment (PEP 668); pipx is the
supported way around that.

**Windows**
```
py -m pip install --user pipx
py -m pipx ensurepath
```

Restart your terminal after `ensurepath` so the updated PATH takes effect.
To upgrade later: `pipx upgrade git-juggler`.

## Dev mode

Use the dev script to start both the backend and frontend dev servers:

```
./scripts/dev.sh [path-to-scan] [--port PORT] [--no-open]
```

- `path-to-scan` is optional. On first run, it seeds the folder whose immediate children are scanned for Git repos.
- `--port PORT` is optional. It changes the backend port from the default `8000`; if you use it, update `src/frontend/vite.config.ts` locally so Vite proxies `/api` and `/ws` to the same port.
- `--no-open` disables opening the app in your browser automatically.

Or run them manually in two terminals:

```
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/git-juggler <path-to-scan> --reload [--no-open]
```

```
cd src/frontend
npm install
npm run dev                                     # http://localhost:5173 (proxies /api and /ws to :8000)
```

Open http://localhost:5173.

By default, `./scripts/dev.sh` opens http://localhost:5173 in your browser.

## Production (single port)

```
cd src/frontend && npm install && npm run build
cd ../.. && .venv/bin/git-juggler <path-to-scan> [--no-open]
```

The backend serves the built frontend in this mode, so only port 8000 is needed.
By default, it opens the app in your browser.

## Build a Python package

The Python wheel includes the built frontend assets. The generated assets are
not committed; `scripts/build-package.sh` builds them and copies them into the
backend package before creating the distributions.

```
python3 -m venv .venv
.venv/bin/pip install build
./scripts/build-package.sh
```

The wheel and source distribution are written to `dist/`.

Install the wheel locally with:

```
pipx install dist/git_juggler-*.whl --force
git-juggler <path-to-scan> [--no-open]
```

Versions are derived from Git tags. GitHub Actions runs the same build, uploads
the distributions as artifacts, and publishes tagged releases to PyPI.
