"""Spectral helpers (counterpart of dsp/fft.ts).

The TypeScript engine carries its own radix-2 FFT; here numpy.fft is the reference. Output
conventions are unchanged: Hann window (symmetric), mean removal, zero padding to `nfft`,
fft-shifted spectrum (index 0 is −fs/2), power in dB with a 1e-12 floor. Agreement with the
TypeScript FFT is ~1e-12 dB for well-conditioned bins.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt
from scipy.signal import windows

FloatArray = npt.NDArray[np.float64]


def next_pow2(n: int) -> int:
    p = 1
    while p < n:
        p <<= 1
    return p


def hann(n: int) -> FloatArray:
    """Symmetric Hann window, w[i] = 0.5 − 0.5·cos(2πi/(n−1)); a single sample has weight 1."""
    return np.asarray(windows.hann(n, sym=True), dtype=np.float64)


def doppler_spectrum(re: npt.ArrayLike, im: npt.ArrayLike, nfft: int) -> FloatArray:
    """Doppler power spectrum (dB) of a complex series: Hann window, mean removed, zero-padded to
    `nfft`, fft-shifted so that index 0 is −fs/2."""
    if nfft & (nfft - 1):
        raise ValueError(f"fft length {nfft} is not a power of two")
    x = np.asarray(re, dtype=np.float64) + 1j * np.asarray(im, dtype=np.float64)
    n = min(x.size, nfft)
    if x.size:
        x = (x - x.mean()) * hann(x.size)
    buf = np.zeros(nfft, dtype=np.complex128)
    buf[:n] = x[:n]
    spec = np.fft.fftshift(np.fft.fft(buf))
    return np.asarray(10 * np.log10(spec.real**2 + spec.imag**2 + 1e-12))


def doppler_freqs(nfft: int, fs: float) -> FloatArray:
    return (np.arange(nfft) - nfft / 2) * fs / nfft


def psd(x: npt.ArrayLike, fs: float) -> tuple[FloatArray, FloatArray]:
    """Single-segment one-sided power spectral density of a real series, dB (Hann window)."""
    xa = np.asarray(x, dtype=np.float64)
    nfft = next_pow2(max(8, xa.size))
    w = hann(xa.size) if xa.size else np.zeros(0)
    mean = xa.mean() if xa.size else 0.0
    buf = np.zeros(nfft)
    buf[: xa.size] = (xa - mean) * w
    wss = float(np.sum(w * w)) or 1.0
    spec = np.fft.rfft(buf)
    f = np.arange(nfft // 2 + 1) * fs / nfft
    scale = np.full(f.size, 2.0)
    scale[0] = 1.0
    scale[-1] = 1.0
    p = 10 * np.log10((spec.real**2 + spec.imag**2) * scale / (fs * wss) + 1e-15)
    return f, p
