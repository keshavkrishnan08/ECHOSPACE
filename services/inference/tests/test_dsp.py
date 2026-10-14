import dataclasses
import math

import numpy as np
import pytest
from scipy.signal import windows

from echospace_inference.align import align_link
from echospace_inference.fft import doppler_freqs, doppler_spectrum, hann, psd
from echospace_inference.hampel import hampel, median
from echospace_inference.sanitize import linear_fit, sanitize_packet, unwrap
from echospace_inference.validate import validate_packets
from echospace_sim.channel import CsiPacket

K = 30
X_MHZ = (np.arange(K) - (K - 1) / 2) * (40e6 / K) / 1e6


def _packet(link: int, seq: int, ts: float, re: np.ndarray, im: np.ndarray, M: int = 3) -> CsiPacket:
    return CsiPacket(link, seq, ts, seq / 100, M, K, re.astype(np.float32), im.astype(np.float32))


def _blank(link: int = 0, seq: int = 0, ts: float = 0.0) -> CsiPacket:
    return _packet(link, seq, ts, np.ones(3 * K), np.zeros(3 * K))


def test_unwrap_matches_numpy_away_from_branch_points() -> None:
    rng = np.random.default_rng(1)
    phase = np.cumsum(rng.uniform(-2.5, 2.5, size=(3, 64)), axis=1)
    wrapped = np.angle(np.exp(1j * phase))
    np.testing.assert_allclose(unwrap(wrapped), np.unwrap(wrapped), atol=1e-12)
    np.testing.assert_allclose(unwrap(wrapped) - wrapped[:, :1], phase - phase[:, :1], atol=1e-9)


def test_unwrap_keeps_offset_across_nan() -> None:
    out = unwrap(np.array([3.0, -3.0, math.nan, -2.9]))
    assert out[1] == pytest.approx(-3.0 + 2 * math.pi)
    assert math.isnan(out[2])
    assert out[3] == pytest.approx(-2.9 + 2 * math.pi)


def test_linear_fit() -> None:
    slope, intercept = linear_fit([0, 1, 2, 3], [1, 3, 5, 7])
    assert (slope, intercept) == pytest.approx((2, 1))
    assert linear_fit([1, 1, 1], [1, 2, 3]) == (0.0, 2.0)


def test_sanitize_removes_common_linear_phase_and_keeps_antenna_differences() -> None:
    h = np.exp(1j * np.array([[0.0], [0.4], [-0.7]])) * (1 + 0.1 * np.cos(np.arange(K)))[None, :]
    corrupted = h * np.exp(1j * (1.3 + 0.37 * X_MHZ))[None, :]
    s = sanitize_packet(corrupted.real.ravel(), corrupted.imag.ravel(), 3, K, X_MHZ, True)
    clean = (s.re + 1j * s.im).reshape(3, K)
    np.testing.assert_allclose(np.angle(clean[0]), 0, atol=1e-12)
    np.testing.assert_allclose(np.angle(clean[1] / clean[0]), 0.4, atol=1e-12)
    np.testing.assert_allclose(np.abs(clean), np.abs(h), rtol=1e-12)
    assert s.slope == pytest.approx(0.37)
    assert math.remainder(s.intercept - 1.3, 2 * math.pi) == pytest.approx(0, abs=1e-12)
    np.testing.assert_allclose(s.phase_san.reshape(3, K)[0], 0, atol=1e-12)


def test_sanitize_disabled_and_missing_reference_antenna() -> None:
    re = np.cos(0.2 * X_MHZ)
    im = np.sin(0.2 * X_MHZ)
    data_re = np.concatenate([np.full(K, np.nan), re, re])
    data_im = np.concatenate([np.full(K, np.nan), im, im])
    s = sanitize_packet(data_re, data_im, 3, K, X_MHZ, True)
    assert np.isnan(s.re[:K]).all()
    assert s.slope == pytest.approx(0.2)
    off = sanitize_packet(data_re, data_im, 3, K, X_MHZ, False)
    np.testing.assert_array_equal(off.re[K:], data_re[K:])


def test_hampel_replaces_isolated_spikes_only() -> None:
    x = np.array([1.0, 1.1, 0.9, 1.0, 9.0, 1.05, 0.95, 1.0])
    y, replaced = hampel(x, 3, 3)
    assert replaced == 1
    assert y[4] == median([1.1, 0.9, 1.0, 9.0, 1.05, 0.95, 1.0])
    np.testing.assert_array_equal(np.delete(y, 4), np.delete(x, 4))


def test_hampel_ignores_nan_and_short_windows() -> None:
    y, replaced = hampel(np.array([1.0, math.nan, 50.0]), 1, 3)
    assert replaced == 0
    assert y[2] == 50.0
    # A zero MAD (constant neighbourhood) never triggers a replacement.
    _, replaced = hampel(np.array([2.0, 2.0, 2.0, 7.0, 2.0]), 2, 3)
    assert replaced == 0


def test_median() -> None:
    assert median([3, 1, 2]) == 2
    assert median([4, 1, 3, 2]) == 2.5


def test_align_reconstructs_missing_timestamps_and_counts_gaps() -> None:
    offset = 0.25
    pkts = [_blank(0, s, offset + s / 100) for s in (0, 1, 3, 4, 5, 9)]
    pkts[3] = dataclasses.replace(pkts[3], timestamp_s=math.nan)
    pkts[0], pkts[1] = pkts[1], pkts[0]
    r = align_link(pkts, 100)
    assert [p.seq for p in r.packets] == [0, 1, 3, 4, 5, 9]
    assert r.reordered == 1
    assert r.gaps == 2
    assert r.reconstructed_timestamps == 1
    assert r.packets[3].timestamp_s == pytest.approx(offset + 0.04)
    assert r.clock_offset_s == pytest.approx(offset)
    assert r.jitter_ms == pytest.approx(0, abs=1e-9)


def test_align_without_valid_timestamps_uses_nominal_clock() -> None:
    r = align_link([_blank(0, 7, math.nan), _blank(0, 8, math.nan)], 100)
    assert [p.timestamp_s for p in r.packets] == pytest.approx([0.07, 0.08])
    assert math.isnan(r.jitter_ms)


def test_validate_rejects_bad_shapes_and_all_nan_packets() -> None:
    good = _blank(0)
    partial = _packet(1, 0, 0, np.concatenate([np.full(K, np.nan), np.ones(2 * K)]), np.zeros(3 * K))
    dead = _packet(1, 1, 0, np.full(3 * K, np.nan), np.zeros(3 * K))
    wrong = _packet(0, 2, 0, np.ones(2 * K), np.zeros(2 * K), M=2)
    unknown = _blank(5)
    r = validate_packets([good, partial, dead, wrong, unknown], 2, [3, 3], K)
    assert r.accepted == [good, partial]
    assert r.rejected == 3
    assert r.missing_antennas == {1: {0, 1, 2}}
    assert len(r.errors) == 2


def test_hann_window() -> None:
    np.testing.assert_allclose(hann(9), 0.5 - 0.5 * np.cos(2 * np.pi * np.arange(9) / 8), atol=1e-15)
    np.testing.assert_array_equal(hann(1), [1.0])
    np.testing.assert_array_equal(hann(16), windows.hann(16))


def test_doppler_spectrum_peaks_at_the_tone_and_is_shifted() -> None:
    fs = 100.0
    n = 64
    t = np.arange(n) / fs
    f0 = 12.5
    x = 3 + np.exp(2j * np.pi * f0 * t)
    spec = doppler_spectrum(x.real, x.imag, 64)
    freqs = doppler_freqs(64, fs)
    assert freqs[0] == -fs / 2 and freqs[32] == 0
    assert freqs[int(np.argmax(spec))] == pytest.approx(f0)
    empty = doppler_spectrum(np.zeros(0), np.zeros(0), 8)
    np.testing.assert_allclose(empty, -120)


def test_psd_of_a_sine() -> None:
    fs = 64.0
    x = np.sin(2 * np.pi * 8 * np.arange(128) / fs)
    f, p = psd(x, fs)
    assert len(f) == 65
    assert f[int(np.argmax(p))] == pytest.approx(8)
