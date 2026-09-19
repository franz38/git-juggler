# git-juggler

Scans the first-level children of a directory for git repos, and serves a web UI
to browse each repo's commit graph and run a real shell, backed by a FastAPI server.

## How to install

git-juggler is published on PyPI. The recommended way to install it is with
[pipx](https://pipx.pypa.io), which puts the `git-juggler` command on your
PATH in its own isolated environment, without touching your system Python:

```
pipx install git-juggler
git-juggler <path-to-scan>   # http://127.0.0.1:8000
```

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

```
python3 -m venv .venv
.venv/bin/pip install -e .
.venv/bin/git-juggler <path-to-scan> --reload   # http://127.0.0.1:8000
```

```
cd src/frontend
npm install
npm run dev                                     # http://localhost:5173 (proxies /api and /ws)
```

Open http://localhost:5173.

## Production (single port)

```
cd src/frontend && npm install && npm run build
cd ../.. && .venv/bin/git-juggler <path-to-scan>   # http://127.0.0.1:8000
```

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
pipx install dist/git_juggler-0.1.0-py3-none-any.whl --force
git-juggler <path-to-scan>   # http://127.0.0.1:8000
```

GitHub Actions runs the same build and uploads the distributions as artifacts.
