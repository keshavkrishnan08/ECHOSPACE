import math

import numpy as np
import pytest

from echospace_sim.channel import ChannelSimulator
from echospace_sim.config import AntennaFault, ScenarioConfig, SubjectSpec
from echospace_sim.presets import load_preset
from echospace_sim.source import SyntheticSource
from echospace_sim.trajectory import compile_path, subject_state_at


def _link_config(**signal: object) -> ScenarioConfig:
    raw = load_preset("A").to_json_dict()
    raw.update(
        scenario="custom",
        obstacles=[],
        sensors=[
            {"id": "a", "role": "tx", "position": [0.5, 2.5, 1.2], "yawDeg": 0, "antennas": 1},
            {"id": "b", "role": "rx", "position": [5.5, 2.5, 1.2], "yawDeg": 180, "antennas": 1},
        ],
    )
    raw["signal"] = {**raw["signal"], **signal}
    return ScenarioConfig.model_validate(raw)


def test_deterministic_for_a_seed() -> None:
    cfg = load_preset("B")
    a = ChannelSimulator(cfg)
    b = ChannelSimulator(cfg)
    st = [subject_state_at(compile_path(cfg.subjects[0]), 3)]
    for seq in range(5):
        for pa, pb in zip(a.packets(seq, st), b.packets(seq, st), strict=True):
            assert (pa is None) == (pb is None)
            if pa is not None and pb is not None:
                np.testing.assert_array_equal(pa.re, pb.re)
                np.testing.assert_array_equal(pa.im, pb.im)
                assert pa.re.dtype == np.float32


def test_different_seed_changes_noise() -> None:
    cfg = load_preset("A")
    a = ChannelSimulator(cfg).packets(0, [])[0]
    b = ChannelSimulator(cfg.model_copy(update={"seed": cfg.seed + 1})).packets(0, [])[0]
    assert a is not None and b is not None
    assert a.re[0] != b.re[0]


def test_body_shadowing_attenuates_line_of_sight() -> None:
    sim = ChannelSimulator(_link_config(maxReflectionOrder=0, subjectScatter=False))
    p0 = float(np.sum(np.abs(sim.channel(0, [])) ** 2))
    spec = SubjectSpec(id="s", label="S", start=(3, 2.5), loop=False)
    blocker = subject_state_at(compile_path(spec), 0)
    p1 = float(np.sum(np.abs(sim.channel(0, [blocker])) ** 2))
    loss_db = 10 * math.log10(p0 / p1)
    assert 5 < loss_db < 9


def test_free_space_line_of_sight_amplitude() -> None:
    sim = ChannelSimulator(_link_config(maxReflectionOrder=0, subjectScatter=False))
    np.testing.assert_allclose(np.abs(sim.channel(0, [])), 1 / 5, rtol=1e-12)
    assert len(sim.paths(0, [])) == 1


def test_reflections_enumerated_in_fixed_order() -> None:
    sim = ChannelSimulator(_link_config())
    kinds = [(p.kind, p.surface) for p in sim.paths(0, [])]
    assert kinds[0] == ("los", None)
    assert [s for _, s in kinds[1:]] == ["south", "east", "north", "west", "floor", "ceiling"]
    limited = ChannelSimulator(_link_config(reflectingSurfaces=2))
    assert [p.surface for p in limited.paths(0, [])[1:]] == ["south", "east"]
    los_only = ChannelSimulator(_link_config(maxReflectionOrder=0))
    assert len(los_only.paths(0, [])) == 1


def test_packet_loss_drops_the_configured_fraction() -> None:
    cfg = load_preset("A")
    cfg.impairments.packet_loss = 0.3
    sim = ChannelSimulator(cfg)
    results = [p for seq in range(200) for p in sim.packets(seq, [])]
    dropped = sum(p is None for p in results) / len(results)
    assert 0.25 < dropped < 0.35


def test_bursts_drop_consecutive_packets() -> None:
    cfg = load_preset("A")
    cfg.impairments.packet_loss = 0
    cfg.impairments.burst_rate_hz = 2
    cfg.impairments.burst_length_packets = 10
    sim = ChannelSimulator(cfg)
    drops = [sim.packets(seq, [])[0] is None for seq in range(300)]
    runs = [len(r) for r in "".join("x" if d else "." for d in drops).split(".") if r]
    assert runs and min(runs) >= 10


def test_missing_antennas_are_nan() -> None:
    cfg = load_preset("I")
    cfg.impairments.packet_loss = 0
    cfg.impairments.missing_antennas = [AntennaFault(sensor_id="N2", antenna=0)]
    sim = ChannelSimulator(cfg)
    link = next(link.index for link in sim.links if link.rx_id == "N2")
    p = sim.packets(0, [])[link]
    assert p is not None
    K = p.subcarriers
    assert np.isnan(p.re[:K]).all() and np.isnan(p.im[:K]).all()
    assert np.isfinite(p.re[K:]).all()


def test_missing_timestamps_are_nan() -> None:
    cfg = load_preset("A")
    cfg.impairments.packet_loss = 0
    cfg.impairments.missing_timestamp_prob = 1
    p = ChannelSimulator(cfg).packets(5, [])[0]
    assert p is not None and math.isnan(p.timestamp_s) and p.true_time_s == pytest.approx(0.05)


def test_synthetic_source_calibration_and_pull() -> None:
    cfg = load_preset("A")
    src = SyntheticSource(cfg)
    cal = src.calibration()
    n_seq = round(cfg.dsp.calibration_seconds * cfg.signal.packet_rate_hz)
    assert 0.95 * n_seq * len(src.links) < len(cal) <= n_seq * len(src.links)
    first = src.pull(0.1)
    assert {p.seq for p in first} == set(range(11))
    assert all(p.seq > 10 for p in src.pull(0.2))
    src.seek(1.0)
    assert min(p.seq for p in src.pull(1.0)) == 100
