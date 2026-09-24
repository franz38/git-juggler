import json

import pytest
from pydantic import ValidationError

from git_juggler import config
from git_juggler.schemas import Preferences


@pytest.fixture(autouse=True)
def isolated_config(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(config, "CONFIG_PATH", tmp_path / "config.json")


def patch(**fields):
    return Preferences(**fields).model_dump(mode="json", exclude_unset=True)


def test_empty_by_default():
    assert config.load_preferences() == Preferences()


def test_update_sets_only_the_given_fields_and_keeps_the_rest():
    config.update_preferences(patch(theme_id="builtin:light", agent_poll_seconds=5))
    result = config.update_preferences(patch(pinned_themes=["a", "b"]))

    assert result.theme_id == "builtin:light"
    assert result.agent_poll_seconds == 5
    assert result.pinned_themes == ["a", "b"]
    assert result.agents_enabled is None


def test_none_clears_a_stored_field():
    config.update_preferences(patch(theme_id="x", agents_enabled=True))
    result = config.update_preferences(patch(theme_id=None))

    assert result.theme_id is None
    assert result.agents_enabled is True


def test_false_and_empty_list_are_real_values_not_cleared():
    result = config.update_preferences(patch(agents_enabled=False, pinned_themes=[]))

    assert result.agents_enabled is False
    assert result.pinned_themes == []


def test_key_bindings_round_trip():
    bindings = {"toggleMenu": {"key": "k", "mod": True, "shift": False, "alt": False}}
    result = config.update_preferences(patch(key_bindings=bindings))

    assert result.key_bindings["toggleMenu"].key == "k"
    assert result.key_bindings["toggleMenu"].mod is True


def test_preferences_live_beside_the_rest_of_the_config():
    config.save_pinned_repo_paths(["/some/repo"])
    config.update_preferences(patch(theme_id="x"))

    assert config.load_pinned_repo_paths() == ["/some/repo"]
    assert json.loads(config.CONFIG_PATH.read_text())["preferences"] == {"theme_id": "x"}


def test_invalid_values_are_rejected_by_the_model():
    with pytest.raises(ValidationError):
        Preferences(agent_poll_seconds=0)
    with pytest.raises(ValidationError):
        Preferences(agent_poll_seconds=100000)
    with pytest.raises(ValidationError):
        Preferences(branch_color_mode="rainbow")


def test_one_bad_stored_field_does_not_discard_the_others():
    config.CONFIG_PATH.write_text(
        json.dumps({"preferences": {"theme_id": "keep-me", "agent_poll_seconds": "soon", "made_up": 1}})
    )

    result = config.load_preferences()

    assert result.theme_id == "keep-me"
    assert result.agent_poll_seconds is None


def test_unknown_patch_keys_are_ignored():
    config.update_preferences({"theme_id": "x", "not_a_setting": 1})

    assert "not_a_setting" not in json.loads(config.CONFIG_PATH.read_text())["preferences"]


def test_onboarding_complete_is_centralized_like_any_other_preference():
    assert config.load_preferences().onboarding_complete is None

    result = config.update_preferences(patch(onboarding_complete=True))
    assert result.onboarding_complete is True

    # A reset (e.g. from the Configuration menu) flips it back to False, not
    # back to unset -- distinguishing "never onboarded" from "explicitly reset".
    result = config.update_preferences(patch(onboarding_complete=False))
    assert result.onboarding_complete is False


def test_reset_to_factory_wipes_everything_and_reseeds_the_default_path(tmp_path):
    config.save_repo_paths([tmp_path / "a", tmp_path / "b"])
    config.save_pinned_repo_paths(["x"])
    config.update_preferences(patch(theme_id="builtin:light", onboarding_complete=True))

    config.reset_to_factory(tmp_path / "default")

    assert config.load_repo_paths() == [tmp_path / "default"]
    assert config.load_pinned_repo_paths() == []
    assert config.load_preferences() == Preferences()
