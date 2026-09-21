import json

from git_juggler.themes import discover_themes, strip_jsonc


def _write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text if isinstance(text, str) else json.dumps(text))


def test_strip_jsonc_keeps_string_contents():
    text = '{ // c\n "a": "x//y,}", /* b */ "l": [1,2,], }'
    assert json.loads(strip_jsonc(text)) == {"a": "x//y,}", "l": [1, 2]}


def test_discover_merges_include_chain_and_localizes_labels(tmp_path):
    ext = tmp_path / "pub.mytheme-1.0.0"
    _write(
        ext / "package.json",
        {
            "contributes": {
                "themes": [
                    {"label": "%child%", "uiTheme": "vs", "path": "./themes/child.json"},
                    {"label": "Broken", "uiTheme": "vs-dark", "path": "./themes/missing.json"},
                ]
            }
        },
    )
    _write(ext / "package.nls.json", {"child": "Child Theme"})
    _write(ext / "themes" / "base.json", '{ // base\n "colors": {"editor.background": "#111", "foreground": "#eee",} }')
    _write(ext / "themes" / "child.json", {"include": "./base.json", "colors": {"foreground": "#fff"}})

    themes = discover_themes([tmp_path])

    assert [t.label for t in themes] == ["Child Theme"]
    theme = themes[0]
    assert theme.uiTheme == "vs"
    assert theme.id == "vscode:pub.mytheme/themes/child.json"
    assert theme.colors == {"editor.background": "#111", "foreground": "#fff"}


def test_include_cannot_escape_extension_dir(tmp_path):
    secret = tmp_path / "secret.json"
    _write(secret, {"colors": {"editor.background": "#123456"}})
    ext = tmp_path / "exts" / "evil"
    _write(ext / "package.json", {"contributes": {"themes": [{"label": "Evil", "path": "./t.json"}]}})
    _write(ext / "t.json", {"include": "../../secret.json", "colors": {"foreground": "#fff"}})

    themes = discover_themes([tmp_path / "exts"])

    assert [t.colors for t in themes] == [{"foreground": "#fff"}]


def test_include_cycle_terminates(tmp_path):
    ext = tmp_path / "cyc"
    _write(ext / "package.json", {"contributes": {"themes": [{"label": "Cyc", "path": "./a.json"}]}})
    _write(ext / "a.json", {"include": "./b.json", "colors": {"foreground": "#aaa"}})
    _write(ext / "b.json", {"include": "./a.json", "colors": {"foreground": "#bbb"}})

    assert [t.label for t in discover_themes([tmp_path])] == ["Cyc"]


def test_newest_extension_version_wins_and_id_is_version_free(tmp_path):
    for version, color in [("2.9.0", "#999"), ("2.10.0", "#101010")]:
        ext = tmp_path / f"pub.dup-{version}-darwin-arm64"
        _write(ext / "package.json", {"contributes": {"themes": [{"label": "Dup", "path": "./t.json"}]}})
        _write(ext / "t.json", {"colors": {"foreground": color}})

    themes = discover_themes([tmp_path])

    assert [(t.id, t.colors["foreground"]) for t in themes] == [("vscode:pub.dup/t.json", "#101010")]


def test_missing_roots_are_ignored(tmp_path):
    assert discover_themes([tmp_path / "nope"]) == []
