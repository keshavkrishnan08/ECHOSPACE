import numpy as np
import pytest
from scipy.special import ndtr

from echospace_inference.linalg import norm_cdf, spd_inverse
from echospace_inference.occupancy import box_filter_3d, ema_in_place, floor_projection
from echospace_inference.rti import RtiModel
from echospace_sim.presets import load_preset
from echospace_sim.scene import build_grid, build_links


@pytest.fixture(scope="module")
def rti() -> RtiModel:
    cfg = load_preset("B")
    return RtiModel(build_grid(cfg.room, 0.5), build_links(cfg.sensors), cfg.recon)


def test_spd_inverse() -> None:
    a = np.array([[4, 1, 0.5], [1, 3, 0.2], [0.5, 0.2, 2]])
    np.testing.assert_allclose(a @ spd_inverse(a), np.eye(3), atol=1e-12)


def test_norm_cdf_is_the_abramowitz_stegun_approximation() -> None:
    x = np.linspace(-8, 8, 2001)
    assert np.max(np.abs(norm_cdf(x) - ndtr(x))) < 1.5e-7
    assert norm_cdf(0.0) == pytest.approx(0.5, abs=1e-9)
    assert norm_cdf(1.96) == pytest.approx(0.975, abs=1e-3)


def test_unobserved_voxels_have_variance_ratio_near_one(rti: RtiModel) -> None:
    cov = rti.coverage()
    assert cov.dtype == np.float32
    assert cov.max() > 0.95
    assert cov.min() < 0.8


def test_voxels_on_link_lines_are_better_constrained_than_corners(rti: RtiModel) -> None:
    cov = rti.coverage().reshape(rti.grid.nz, rti.grid.ny, rti.grid.nx)
    centre = cov[2, rti.grid.ny // 2, rti.grid.nx // 2]
    ceiling_corner = cov[-1, 0, 0]
    assert centre < ceiling_corner


def test_zero_attenuation_gives_no_confident_occupancy(rti: RtiModel) -> None:
    r = rti.reconstruct(np.zeros(rti.L))
    assert r.occupancy.max() <= 0.5
    assert r.active_links == rti.L


def test_dropping_links_raises_posterior_variance(rti: RtiModel) -> None:
    y = np.zeros(rti.L)
    full = rti.reconstruct(y).variance_ratio
    y[:20] = np.nan
    some = rti.reconstruct(y)
    assert some.active_links == rti.L - 20
    assert some.variance_ratio.mean() > full.mean()
    assert np.all(some.variance_ratio >= full - 1e-6)


def test_no_links_means_unknown(rti: RtiModel) -> None:
    r = rti.reconstruct(np.full(rti.L, np.nan))
    assert r.active_links == 0
    assert np.all(r.occupancy == 0.5) and np.all(r.variance_ratio == 1)


def test_attenuation_on_crossing_links_localises(rti: RtiModel) -> None:
    g = rti.grid
    target = np.array([3.0, 2.5, 1.0])
    y = np.zeros(rti.L)
    for li, link in enumerate(rti.links):
        a = np.asarray(link.tx)
        b = np.asarray(link.rx)
        t = np.clip(np.dot(target - a, b - a) / np.dot(b - a, b - a), 0, 1)
        if np.linalg.norm(a + t * (b - a) - target) < 0.3:
            y[li] = 6.0
    r = rti.reconstruct(y)
    peak = g.centers[int(np.argmax(r.image))]
    assert np.hypot(*(peak[:2] - target[:2])) < 0.75
    assert r.occupancy.max() > 0.9


def test_ema_and_box_filter() -> None:
    state = np.zeros(4, dtype=np.float32)
    ema_in_place(state, np.ones(4, dtype=np.float32), 0.25)
    np.testing.assert_allclose(state, 0.75)
    ema_in_place(state, np.full(4, 2, dtype=np.float32), 0)
    np.testing.assert_array_equal(state, 2)

    cfg = load_preset("A")
    g = build_grid(cfg.room, 0.5)
    field = np.zeros(g.count, dtype=np.float32)
    field[0] = 8
    out = box_filter_3d(field, g)
    assert out.dtype == np.float32
    assert out[0] == pytest.approx(1.0)
    np.testing.assert_allclose(box_filter_3d(np.ones(g.count), g), 1)


def test_floor_projection() -> None:
    g = build_grid(load_preset("A").room, 0.5)
    field = np.full(g.count, -1.0, dtype=np.float32)
    field[g.nx * g.ny * 3 + 5] = 0.7
    field[g.nx * g.ny * 4 + 6] = np.nan
    out = floor_projection(field, g)
    assert out.shape == (g.nx * g.ny,)
    assert out[5] == pytest.approx(0.7) and out[6] == 0 and out[0] == 0
