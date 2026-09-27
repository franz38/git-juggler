import subprocess

import pytest

from git_juggler.ui import folder_picker as pf


def _fake_run(returncode, stdout):
    def run(cmd, **kwargs):
        return subprocess.CompletedProcess(cmd, returncode, stdout=stdout, stderr="")

    return run


def test_returns_path_without_trailing_slash(monkeypatch):
    monkeypatch.setattr(pf, "_command", lambda: ["x"])
    monkeypatch.setattr(pf.subprocess, "run", _fake_run(0, "/Users/me/Documents/2026/\n"))
    assert pf.pick_folder() == "/Users/me/Documents/2026"


def test_cancel_returns_none(monkeypatch):
    monkeypatch.setattr(pf, "_command", lambda: ["x"])
    monkeypatch.setattr(pf.subprocess, "run", _fake_run(1, ""))
    assert pf.pick_folder() is None


def test_missing_binary_is_unavailable(monkeypatch):
    def run(cmd, **kwargs):
        raise FileNotFoundError("osascript")

    monkeypatch.setattr(pf, "_command", lambda: ["x"])
    monkeypatch.setattr(pf.subprocess, "run", run)
    with pytest.raises(pf.NativePickerUnavailable):
        pf.pick_folder()
