"""Cross-checks of the native DSP library against NumPy/SciPy references written here.

The references are deliberately written from the documented definitions (np.fft, np.unwrap,
np.polyfit, scipy.signal.windows.hann, scipy.special.ndtr) rather than ported from the C++,
so agreement is evidence that both match the TypeScript semantics.

Tolerances (see also docs/native-engine.md):
  * float64 element-wise results: rtol 1e-9.
  * Results that are sums of many terms with possible cancellation (FFT bins, matrix-vector
    products, back-projection sums, detrended phase) also get an absolute floor scaled to
    the data, because floating-point error bounds for these operations are norm-wise, not
    element-wise: a bin near zero cannot be computed to 1e-9 relative accuracy by any
    float64 FFT. The floor is 1e-12 x the largest magnitude in the reference.
  * dB spectra: atol 1e-9 dB on top of rtol 1e-9 (low-power bins have larger relative error
    in power; 1e-9 dB corresponds to a 2.3e-10 relative power error).
  * Phi vs scipy.special.ndtr: atol 2e-7, since the engine uses the A&S 7.1.26 erf
    approximation (|error| <= 1.5e-7). The same formula reimplemented in NumPy is matched at
    rtol 1e-12.
  * Hampel output is compared exactly: it only selects/copies inputs and averages two of them.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from numpy.testing import assert_allclose, assert_array_equal
from scipy.signal import windows
from scipy.special import ndtr

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "python"))

import echospace_native as native  # noqa: E402

pytestmark = pytest.mark.skipif(
    not native.available(),
    reason="native library not built (cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release "
    "&& cmake --build engine/build -j) and ECHOSPACE_NATIVE_LIB not set",
)

RTOL = 1e-9


def scaled_atol(ref, factor: float = 1e-12) -> float:
    return factor * float(np.max(np.abs(ref)))


@pytest.fixture
def rng():
    return np.random.default_rng(20261014)


def crandn(rng, *shape):
    return rng.standard_normal(shape) + 1j * rng.standard_normal(shape)


# --- references ---------------------------------------------------------------------------------


def ref_doppler(x: np.ndarray, nfft: int) -> np.ndarray:
    n = x.shape[-1]
    w = windows.hann(n, sym=True)
    xw = (x - x.mean(axis=-1, keepdims=True)) * w
    if n >= nfft:
        xw = xw[..., :nfft]
    else:
        xw = np.concatenate([xw, np.zeros(x.shape[:-1] + (nfft - n,))], axis=-1)
    X = np.fft.fftshift(np.fft.fft(xw, axis=-1), axes=-1)
    return 10 * np.log10(np.abs(X) ** 2 + 1e-12)


def unwrap_ts(phase: np.ndarray) -> np.ndarray:
    """np.unwrap along the last axis, with the NaN rule of sanitize.ts.

    np.unwrap accumulates corrections with a cumulative sum, so one NaN poisons every later
    sample. sanitize.ts instead skips steps whose difference is NaN: only the NaN sample
    itself stays NaN. Rows without NaN go straight through np.unwrap.
    """
    out = np.unwrap(phase, axis=-1)
    for idx in zip(*np.nonzero(np.isnan(phase).any(axis=-1))):
        p = phase[idx]
        dd = np.diff(p)
        ddmod = np.mod(dd + np.pi, 2 * np.pi) - np.pi
        ddmod[(ddmod == -np.pi) & (dd > 0)] = np.pi
        corr = ddmod - dd
        corr[~(np.abs(dd) >= np.pi)] = 0.0  # also zeroes NaN steps
        out[idx] = p + np.concatenate([[0.0], np.cumsum(corr)])
    return out


def ref_sanitize(h: np.ndarray, x: np.ndarray):
    """h: [M, K]."""
    M, _ = h.shape
    ref = -1
    for m in range(M):
        if np.isfinite(h[m, 0].real) and np.isfinite(h[m, 0].imag):
            ref = m
            break
    unw = unwrap_ts(np.angle(h))
    slope = intercept = 0.0
    if ref >= 0:
        slope, intercept = np.polyfit(x, unw[ref], 1)
    corr = slope * x + intercept
    return h * np.exp(-1j * corr), unw - corr, slope, intercept, ref


def ref_hampel(x: np.ndarray, hw: int, n_sigma: float):
    y = x.copy()
    replaced = 0
    for i in range(len(x)):
        win = x[max(0, i - hw) : min(len(x), i + hw + 1)]
        win = win[np.isfinite(win)]
        if len(win) < 3:
            continue
        med = np.median(win)
        mad = 1.4826 * np.median(np.abs(win - med))
        if np.isfinite(x[i]) and abs(x[i] - med) > n_sigma * mad and mad > 0:
            y[i] = med
            replaced += 1
    return y, replaced


def as_norm_cdf(x):
    """A&S 7.1.26 as written in recon/linalg.ts, vectorised."""
    x = np.asarray(x, dtype=np.float64)
    z = np.abs(x) / np.sqrt(2.0)
    t = 1.0 / (1.0 + 0.3275911 * z)
    y = 1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * np.exp(-z * z)
    return np.where(x >= 0, 0.5 * (1 + y), 0.5 * (1 - y))


def ref_rti(pi, sd, vr, y, z0):
    img = y @ pi.T
    with np.errstate(divide="ignore", invalid="ignore"):
        z = np.where(sd > 1e-12, img / sd, 0.0)
    occ_exact = np.where(vr > 0.95, 0.5, ndtr(z - z0))
    occ_as = np.where(vr > 0.95, 0.5, as_norm_cdf(z - z0))
    return img, z, occ_exact, occ_as


def ref_backprojection(tau, dyn, norm, f0, df, link_valid, antennas):
    V, L, Mmax = tau.shape
    K = dyn.shape[-1]
    f = f0 + df * np.arange(K)
    phase = np.exp(1j * 2 * np.pi * f[None, None, None, :] * tau[..., None])  # V L M K
    d = np.where(np.isnan(dyn.real), 0, dyn)
    mask = np.arange(Mmax)[None, :] < antennas[:, None]  # L M
    d = d * mask[..., None]
    s = np.einsum("vlmk,lmk->vl", phase, d)
    nrm = np.where((norm == 0) | np.isnan(norm), 1.0, norm)
    return ((np.abs(s) ** 2 / nrm) * link_valid[None, :]).sum(axis=1)


# --- tests ----------------------------------------------------------------------------------


def test_abi_version():
    assert native.abi_version() == native.EXPECTED_ABI_VERSION


@pytest.mark.parametrize("n", [1, 2, 7, 64, 255])
def test_hann(n):
    assert_allclose(native.hann(n), windows.hann(n, sym=True), rtol=RTOL, atol=1e-15)


@pytest.mark.parametrize("n", [1, 2, 8, 64, 1024, 4096])
def test_fft_forward_inverse(rng, n):
    x = crandn(rng, n)
    X = np.fft.fft(x)
    assert_allclose(native.fft(x), X, rtol=RTOL, atol=scaled_atol(X))
    xi = np.fft.ifft(x)
    assert_allclose(native.fft(x, inverse=True), xi, rtol=RTOL, atol=scaled_atol(xi))


@pytest.mark.parametrize("rows,n", [(1024, 64), (64, 1024), (3, 2)])
def test_fft_batch(rng, rows, n):
    x = crandn(rng, rows, n)
    X = np.fft.fft(x, axis=1)
    assert_allclose(native.fft_batch(x), X, rtol=RTOL, atol=scaled_atol(X))
    assert_allclose(native.fft_batch(native.fft_batch(x), inverse=True), x, rtol=RTOL, atol=scaled_atol(x))


def test_fft_rejects_non_power_of_two(rng):
    with pytest.raises(native.NativeError) as err:
        native.fft(crandn(rng, 12))
    assert err.value.status == -3


@pytest.mark.parametrize("n,nfft", [(128, 256), (64, 64), (100, 128), (300, 256), (1, 8)])
def test_doppler_spectrum(rng, n, nfft):
    # Static offset + a moving tone + noise, as a CSI time series would look.
    t = np.arange(n)
    x = (3 - 2j) + 0.5 * np.exp(2j * np.pi * 0.11 * t) + 0.05 * crandn(rng, n)
    assert_allclose(native.doppler_spectrum(x, nfft), ref_doppler(x, nfft), rtol=RTOL, atol=1e-9)


def test_doppler_spectrum_batch(rng):
    x = crandn(rng, 84, 128) + 2.0
    got = native.doppler_spectrum_batch(x, 256)
    assert got.shape == (84, 256)
    assert_allclose(got, ref_doppler(x, 256), rtol=RTOL, atol=1e-9)


def make_csi(rng, P, M, K, x):
    """Packets with a random common phase line (CFO/STO) plus per-antenna offsets and noise."""
    slope = rng.uniform(-0.6, 0.6, size=(P, 1, 1))
    icpt = rng.uniform(-np.pi, np.pi, size=(P, 1, 1))
    ant = rng.uniform(-np.pi, np.pi, size=(P, M, 1))
    amp = 1 + 0.3 * rng.standard_normal((P, M, K))
    phase = slope * x[None, None, :] + icpt + ant + 0.05 * rng.standard_normal((P, M, K))
    return amp * np.exp(1j * phase)


def test_sanitize_packets(rng):
    P, M, K = 28, 3, 30
    x = np.arange(K) - (K - 1) / 2
    h = make_csi(rng, P, M, K, x)
    got = native.sanitize_packets(h, x)
    for p in range(P):
        csi, phase, slope, icpt, ref = ref_sanitize(h[p], x)
        assert got["ref"][p] == ref
        assert_allclose(got["slope"][p], slope, rtol=RTOL)
        assert_allclose(got["intercept"][p], icpt, rtol=RTOL, atol=1e-12)
        assert_allclose(got["csi"][p], csi, rtol=RTOL, atol=scaled_atol(csi))
        assert_allclose(got["phase"][p], phase, rtol=RTOL, atol=scaled_atol(phase))


def test_sanitize_nonuniform_offsets_and_nan_reference(rng):
    M, K = 3, 30
    # Intel 5300-style grouped subcarrier indices.
    x = np.concatenate([np.arange(-28, 0, 2), [-1, 1], np.arange(3, 28, 2), [28]]).astype(float)
    assert len(x) == K
    h = make_csi(rng, 1, M, K, x)[0]
    h[0, 0] = np.nan + 0j
    got = native.sanitize_packets(h, x)
    csi, phase, slope, icpt, ref = ref_sanitize(h, x)
    assert ref == 1 and got["ref"] == 1
    assert_allclose(got["slope"], slope, rtol=RTOL)
    assert_allclose(got["intercept"], icpt, rtol=RTOL, atol=1e-12)
    ok = np.isfinite(csi)
    assert_array_equal(np.isfinite(got["csi"]), ok)
    assert_allclose(got["csi"][ok], csi[ok], rtol=RTOL, atol=scaled_atol(csi[ok]))
    # Only the NaN sample itself is NaN in the sanitized phase (sanitize.ts unwrap rule).
    assert np.isnan(got["phase"]).sum() == 1
    assert_array_equal(np.isnan(got["phase"]), np.isnan(phase))
    fin = np.isfinite(phase)
    assert_allclose(got["phase"][fin], phase[fin], rtol=RTOL, atol=scaled_atol(phase[fin]))


@pytest.mark.parametrize("hw,n_sigma", [(3, 3.0), (5, 2.0), (1, 3.0), (20, 1.0)])
def test_hampel(rng, hw, n_sigma):
    x = np.cumsum(rng.standard_normal(400)) * 0.1
    spikes = rng.choice(400, 20, replace=False)
    x[spikes] += rng.choice([-1, 1], 20) * rng.uniform(3, 10, 20)
    x[rng.choice(400, 8, replace=False)] = np.nan
    x[:6] = 1.0  # flat stretch -> MAD == 0 edge case
    y, r = native.hampel(x, hw, n_sigma)
    y_ref, r_ref = ref_hampel(x, hw, n_sigma)
    assert r == r_ref
    assert_array_equal(y, y_ref)


def test_norm_cdf():
    xs = np.linspace(-8, 8, 4001)
    got = native.norm_cdf(xs)
    assert_allclose(got, as_norm_cdf(xs), rtol=1e-12, atol=0)
    assert_allclose(got, ndtr(xs), rtol=0, atol=2e-7)


def make_rti(rng, V, L):
    pi = 0.05 * rng.standard_normal((V, L))
    sd = rng.uniform(0.05, 0.5, V)
    sd[::97] = 0.0  # unobserved voxels: z forced to 0
    vr = rng.uniform(0, 1, V)
    return pi, sd, vr


def test_rti_apply(rng):
    V, L, z0 = 5280, 28, 1.5
    pi, sd, vr = make_rti(rng, V, L)
    y = 2 * rng.standard_normal(L)
    got = native.rti_apply(pi, sd, vr, y, z0)
    img, z, occ_exact, occ_as = ref_rti(pi, sd, vr, y[None], z0)
    assert_allclose(got["image"], img[0], rtol=RTOL, atol=scaled_atol(img))
    assert_allclose(got["z"], z[0], rtol=RTOL, atol=scaled_atol(z))
    assert_allclose(got["occupancy"], occ_exact[0], rtol=0, atol=2e-7)
    assert_allclose(got["occupancy"], occ_as[0], rtol=1e-12, atol=1e-15)
    assert np.all(got["occupancy"][vr > 0.95] == 0.5)


def test_rti_apply_batch(rng):
    V, L, F, z0 = 5280, 28, 100, 1.5
    pi, sd, vr = make_rti(rng, V, L)
    y = 2 * rng.standard_normal((F, L))
    got = native.rti_apply_batch(pi, sd, vr, y, z0)
    img, z, occ_exact, occ_as = ref_rti(pi, sd, vr, y, z0)
    assert got["image"].shape == (F, V)
    assert_allclose(got["image"], img, rtol=RTOL, atol=scaled_atol(img))
    assert_allclose(got["z"], z, rtol=RTOL, atol=scaled_atol(z))
    assert_allclose(got["occupancy"], occ_exact, rtol=0, atol=2e-7)
    assert_allclose(got["occupancy"], occ_as, rtol=1e-12, atol=1e-15)
    single = native.rti_apply(pi, sd, vr, y[7], z0)
    assert_array_equal(single["occupancy"], got["occupancy"][7])


def test_backprojection(rng):
    V, L, Mmax, K = 600, 6, 3, 30
    f0, df = 5.18e9, 312.5e3 * 2
    tau = rng.uniform(0, 40e-9, (V, L, Mmax))
    dyn = crandn(rng, L, Mmax, K)
    dyn[1, 2, 5] = np.nan
    norm = rng.uniform(0.5, 2.0, L)
    norm[2] = 0.0
    valid = np.array([1, 1, 1, 0, 1, 1], dtype=bool)
    ants = np.array([3, 3, 2, 3, 1, 3])
    got = native.backprojection(tau, dyn, norm, f0, df, link_valid=valid, antennas=ants)
    ref = ref_backprojection(tau, dyn, norm, f0, df, valid, ants)
    assert_allclose(got, ref, rtol=RTOL, atol=scaled_atol(ref))


def test_backprojection_benchmark_shape(rng):
    V, L, M, K = 5280, 28, 3, 30
    tau = rng.uniform(0, 40e-9, (V, L, M))
    dyn = crandn(rng, L, M, K)
    norm = rng.uniform(0.5, 2.0, L)
    got = native.backprojection(tau, dyn, norm, 5.18e9, 312.5e3)
    ref = ref_backprojection(tau, dyn, norm, 5.18e9, 312.5e3, np.ones(L), np.full(L, M))
    assert_allclose(got, ref, rtol=RTOL, atol=scaled_atol(ref))


def test_unavailable_library_reports_clearly():
    code = (
        "import echospace_native as n\n"
        "assert not n.available()\n"
        "try:\n    n.hann(4)\nexcept n.NativeUnavailable as e:\n    print('OK', e)\n"
    )
    env = dict(os.environ, ECHOSPACE_NATIVE_LIB="/nonexistent/libechospace_dsp.so")
    env["PYTHONPATH"] = str(Path(__file__).resolve().parents[1] / "python")
    out = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True)
    assert out.stdout.startswith("OK") and "cmake" in out.stdout
