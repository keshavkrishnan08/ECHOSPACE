import math

import numpy as np
import pytest

from echospace_sim.config import SubjectSpec
from echospace_sim.presets import load_preset
from echospace_sim.trajectory import compile_path, skeleton, subject_state_at


def test_walks_at_configured_speed_and_loops_back() -> None:
    cfg = load_preset("B")
    p = compile_path(cfg.subjects[0])
    s0 = subject_state_at(p, 0)
    s1 = subject_state_at(p, 1)
    assert math.hypot(s1.position[0] - s0.position[0], s1.position[1] - s0.position[1]) == pytest.approx(1, abs=1e-6)
    end = subject_state_at(p, p.period - 1e-6)
    assert math.hypot(end.position[0] - 1.2, end.position[1] - 1.2) < 0.05
    assert s0.joints.shape == (51,)
    assert s0.joints.dtype == np.float32
    assert s0.posture == "walking"


def test_loops_periodically() -> None:
    p = compile_path(load_preset("B").subjects[0])
    a = subject_state_at(p, 2.3)
    b = subject_state_at(p, 2.3 + p.period)
    assert a.position == pytest.approx(b.position, abs=1e-9)


def test_absent_before_start_delay() -> None:
    cfg = load_preset("E")
    assert not subject_state_at(compile_path(cfg.subjects[2]), 1).present


def test_absent_after_end_without_loop() -> None:
    spec = SubjectSpec(id="s", label="S", start=(1, 1), actions=[{"type": "stop", "durationS": 2}], loop=False)
    p = compile_path(spec)
    assert subject_state_at(p, 1).present
    assert not subject_state_at(p, 3).present


def test_sitting_lowers_the_body() -> None:
    spec = SubjectSpec(id="s", label="S", start=(2, 2), actions=[{"type": "sit", "durationS": 6}], loop=False)
    p = compile_path(spec)
    stand = subject_state_at(p, 0)
    sit = subject_state_at(p, 3)
    assert sit.posture == "sitting" and sit.sit_blend == 1
    assert sit.axis_top < stand.axis_top


def test_scatterers_derive_from_float32_joints() -> None:
    s = subject_state_at(compile_path(load_preset("B").subjects[0]), 4.2)
    j = s.joints.astype(np.float64)
    torso_x = (j[15] + j[18] + j[33] + j[36]) / 4
    assert s.scatterers[0][0] == torso_x
    assert s.scatterers[1][:3] == tuple(j[0:3])
    assert s.axis_top == j[2] + 0.08


def test_skeleton_heading_rotates_the_body() -> None:
    a = skeleton(0, 0, 0, 1.75, 0, False, 0).reshape(17, 3)
    b = skeleton(0, 0, math.pi / 2, 1.75, 0, False, 0).reshape(17, 3)
    np.testing.assert_allclose(b[:, 0], -a[:, 1], atol=1e-6)
    np.testing.assert_allclose(b[:, 2], a[:, 2])
