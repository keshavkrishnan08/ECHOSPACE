import math

import pytest

from echospace_sim.geometry import js_hypot, js_round, segment_box_overlap, segment_segment_distance


def test_segment_box_overlap() -> None:
    assert segment_box_overlap((0, 0.5, 0.5), (3, 0.5, 0.5), (1, 0, 0), (2, 1, 1)) == pytest.approx(1, abs=1e-9)
    assert segment_box_overlap((0, 2, 0.5), (3, 2, 0.5), (1, 0, 0), (2, 1, 1)) == 0


def test_segment_box_overlap_diagonal() -> None:
    length = segment_box_overlap((0, 0, 0), (2, 2, 2), (0.5, 0.5, 0.5), (1.5, 1.5, 1.5))
    assert length == pytest.approx(math.sqrt(3), abs=1e-12)


def test_segment_segment_distance() -> None:
    d, s = segment_segment_distance((0, 0, 1), (2, 0, 1), (1, 1, 0), (1, 1, 2))
    assert d == pytest.approx(1, abs=1e-9)
    assert s == pytest.approx(0.5, abs=1e-9)


def test_segment_segment_distance_parallel_and_clamped() -> None:
    d, _ = segment_segment_distance((0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0))
    assert d == pytest.approx(1)
    d, s = segment_segment_distance((0, 0, 0), (1, 0, 0), (3, 0, -1), (3, 0, 1))
    assert d == pytest.approx(2)
    assert s == pytest.approx(1)


def test_js_round_rounds_half_up() -> None:
    assert js_round(2.5) == 3
    assert js_round(-2.5) == -2
    assert js_round(0.49999) == 0


def test_js_hypot_matches_v8_values() -> None:
    # Values printed by Node 22 (V8) for Math.hypot; math.hypot differs in the last bit for the second.
    assert js_hypot(3, 4) == 5
    assert js_hypot(0.1, 0.2, 0.3) == 0.37416573867739417
    assert js_hypot(0, 0, 1.4) == 1.4
    assert js_hypot(0, 0) == 0
