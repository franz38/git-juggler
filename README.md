# git-juggler

Scans the first-level children of a directory for git repos, and serves a web UI
to browse each repo's commit graph and run a real shell, backed by a FastAPI server.

## Dev mode

```
cd backend
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/git-juggler <path-to-scan> --reload   # http://127.0.0.1:8000
```

```
cd frontend
npm install
npm run dev                                     # http://localhost:5173 (proxies /api and /ws)
```

Open http://localhost:5173.

## Production (single port)

```
cd frontend && npm install && npm run build
cd ../backend && .venv/bin/git-juggler <path-to-scan>   # http://127.0.0.1:8000
```

## Build a Python package

The Python wheel includes the built frontend assets. The generated assets are
not committed; `scripts/build-package.sh` builds them and copies them into the
backend package before creating the distributions.

```
python3 -m venv backend/.venv
backend/.venv/bin/pip install build
./scripts/build-package.sh
```

The wheel and source distribution are written to `backend/dist/`.

Install the wheel locally with:

```
pipx install backend/dist/git_juggler-0.1.0-py3-none-any.whl --force
git-juggler <path-to-scan>   # http://127.0.0.1:8000
```

GitHub Actions runs the same build and uploads the distributions as artifacts.
