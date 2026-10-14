import json
from importlib import resources

import pytest
from pydantic import ValidationError

from echospace_sim.config import ScenarioConfig, SignalConfig, parse_scenario
from echospace_sim.presets import list_presets, load_preset
from echospace_sim.scene import build_grid, build_links

KEYS = list("ABCDEFGHIJ")


def _raw(key: str) -> dict:
    path = resources.files("echospace_sim").joinpath("presets", f"{key}.json")
    return json.loads(path.read_text(encoding="utf-8"))


def test_presets_list() -> None:
    presets = list_presets()
    assert [p["key"] for p in presets] == KEYS
    assert all(p["title"] and p["difficulty"] for p in presets)


@pytest.mark.parametrize("key", KEYS)
def test_every_preset_validates_and_round_trips(key: str) -> None:
    cfg = load_preset(key)
    assert cfg.scenario == key
    assert len(build_links(cfg.sensors)) > 0
    assert cfg.to_json_dict() == _raw(key)["config"]


def test_unknown_preset() -> None:
    with pytest.raises(KeyError):
        load_preset("Z")


def test_defaults_match_the_zod_schema() -> None:
    sig = SignalConfig()
    assert (sig.center_freq_hz, sig.bandwidth_hz, sig.subcarriers, sig.packet_rate_hz, sig.snr_db) == (
        5.32e9,
        40e6,
        30,
        100,
        25,
    )
    cfg = load_preset("B")
    assert cfg.recon.voxel_size_m == 0.25
    assert cfg.dsp.hampel.half_window == 3
    assert cfg.tracking.filter == "kalman"


def test_links_and_grid() -> None:
    cfg = load_preset("B")
    assert len(build_links(cfg.sensors)) == 28
    g = build_grid(cfg.room, 0.25)
    assert (g.nx, g.ny, g.nz) == (24, 20, 11)
    assert g.centers.shape == (g.count, 3)


def test_accepts_camel_and_snake_case() -> None:
    raw = _raw("A")["config"]
    snake = load_preset("A").model_dump()
    assert parse_scenario(raw) == parse_scenario(snake)


def test_rejects_out_of_range_and_unknown_fields() -> None:
    raw = _raw("A")["config"]
    with pytest.raises(ValidationError):
        ScenarioConfig.model_validate({**raw, "signal": {**raw["signal"], "snrDb": 80}})
    with pytest.raises(ValidationError):
        ScenarioConfig.model_validate({**raw, "signal": {**raw["signal"], "subcarriers": 30.5}})
    with pytest.raises(ValidationError):
        ScenarioConfig.model_validate({**raw, "bogus": 1})
    with pytest.raises(ValidationError):
        ScenarioConfig.model_validate({**raw, "sensors": raw["sensors"][:1]})


def test_motion_actions_are_discriminated() -> None:
    raw = _raw("B")["config"]
    raw["subjects"][0]["actions"].append({"type": "jump", "durationS": 1})
    with pytest.raises(ValidationError):
        ScenarioConfig.model_validate(raw)
