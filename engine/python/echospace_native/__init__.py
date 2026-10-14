"""ctypes bindings for the ECHOSPACE native DSP library (libechospace_dsp).

The functions mirror the C ABI in engine/dsp/include/echospace/dsp_c.h and take and return
NumPy arrays. Complex inputs may be given as complex arrays; they are split into float64
real/imaginary planes before the call.

The shared library is located, in order, via:
  1. the ECHOSPACE_NATIVE_LIB environment variable (full path to the library file);
  2. <repo>/engine/build/lib/ (the default CMake build directory).

If it cannot be loaded, every function raises NativeUnavailable; use available() to check.
"""

from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path

import numpy as np

__all__ = [
    "NativeUnavailable",
    "NativeError",
    "available",
    "library_path",
    "abi_version",
    "hann",
    "fft",
    "fft_batch",
    "doppler_spectrum",
    "doppler_spectrum_batch",
    "sanitize_packets",
    "hampel",
    "norm_cdf",
    "rti_apply",
    "rti_apply_batch",
    "backprojection",
]

EXPECTED_ABI_VERSION = 1

_ENGINE_DIR = Path(__file__).resolve().parents[2]
_DEFAULT_BUILD_DIR = _ENGINE_DIR / "build"


class NativeUnavailable(RuntimeError):
    """The native library is not built or could not be loaded."""


class NativeError(RuntimeError):
    """A native call returned a non-zero status."""

    def __init__(self, func: str, status: int, message: str):
        super().__init__(f"{func} failed with status {status}: {message}")
        self.status = status


def _lib_names() -> list[str]:
    if sys.platform == "darwin":
        return ["libechospace_dsp.dylib"]
    if os.name == "nt":
        return ["echospace_dsp.dll"]
    return ["libechospace_dsp.so"]


def _candidates() -> list[Path]:
    env = os.environ.get("ECHOSPACE_NATIVE_LIB")
    if env:
        return [Path(env)]
    out = []
    for sub in ("lib", "bin", ""):
        for name in _lib_names():
            out.append(_DEFAULT_BUILD_DIR / sub / name)
    return out


_D = ctypes.POINTER(ctypes.c_double)
_SZ = ctypes.c_size_t

_SIGNATURES = {
    "es_abi_version": (ctypes.c_int, []),
    "es_status_string": (ctypes.c_char_p, [ctypes.c_int]),
    "es_hann": (ctypes.c_int, [_D, _SZ]),
    "es_fft": (ctypes.c_int, [_D, _D, _SZ, ctypes.c_int]),
    "es_fft_batch": (ctypes.c_int, [_D, _D, _SZ, _SZ, ctypes.c_int]),
    "es_doppler_spectrum": (ctypes.c_int, [_D, _D, _SZ, _SZ, _D]),
    "es_doppler_spectrum_batch": (ctypes.c_int, [_D, _D, _SZ, _SZ, _SZ, _D]),
    "es_sanitize_packets": (
        ctypes.c_int,
        [_D, _D, _SZ, _SZ, _SZ, _D, _D, _D, _D, _D, _D, ctypes.POINTER(ctypes.c_int32)],
    ),
    "es_hampel": (ctypes.c_int, [_D, _SZ, _SZ, ctypes.c_double, _D, ctypes.POINTER(_SZ)]),
    "es_norm_cdf": (ctypes.c_double, [ctypes.c_double]),
    "es_rti_apply": (ctypes.c_int, [_D, _D, _D, _SZ, _SZ, _D, ctypes.c_double, _D, _D, _D]),
    "es_rti_apply_batch": (
        ctypes.c_int,
        [_D, _D, _D, _SZ, _SZ, _D, _SZ, ctypes.c_double, _D, _D, _D],
    ),
    "es_backprojection": (
        ctypes.c_int,
        [
            _D, _SZ, _SZ, _SZ, _SZ, _D, _D,
            ctypes.POINTER(ctypes.c_uint8), ctypes.POINTER(ctypes.c_int32),
            _D, ctypes.c_double, ctypes.c_double, _D,
        ],
    ),
}

_lib: ctypes.CDLL | None = None
_lib_path: Path | None = None
_load_error: str | None = None


def _load() -> ctypes.CDLL:
    global _lib, _lib_path, _load_error
    if _lib is not None:
        return _lib
    tried = []
    for path in _candidates():
        tried.append(str(path))
        if not path.is_file():
            continue
        try:
            lib = ctypes.CDLL(str(path))
        except OSError as exc:
            _load_error = f"failed to load {path}: {exc}"
            continue
        for name, (restype, argtypes) in _SIGNATURES.items():
            fn = getattr(lib, name)
            fn.restype = restype
            fn.argtypes = argtypes
        abi = lib.es_abi_version()
        if abi != EXPECTED_ABI_VERSION:
            _load_error = f"{path} has ABI version {abi}, bindings expect {EXPECTED_ABI_VERSION}"
            continue
        _lib, _lib_path = lib, path
        return lib
    msg = _load_error or "native library not found (looked in: " + ", ".join(tried) + ")"
    raise NativeUnavailable(
        msg + ". Build it with: cmake -S engine -B engine/build -DCMAKE_BUILD_TYPE=Release && "
        "cmake --build engine/build -j, or set ECHOSPACE_NATIVE_LIB."
    )


def available() -> bool:
    """True if the native library can be loaded."""
    try:
        _load()
    except NativeUnavailable:
        return False
    return True


def library_path() -> Path:
    _load()
    assert _lib_path is not None
    return _lib_path


def abi_version() -> int:
    return int(_load().es_abi_version())


# --- helpers ----------------------------------------------------------------------------------


def _f64(a) -> np.ndarray:
    return np.ascontiguousarray(a, dtype=np.float64)


def _ptr(a: np.ndarray | None, ctype=ctypes.c_double):
    if a is None:
        return None
    return a.ctypes.data_as(ctypes.POINTER(ctype))


def _split(x, re=None, im=None) -> tuple[np.ndarray, np.ndarray]:
    """Accepts a complex array, or separate re/im arrays."""
    if im is not None or re is not None:
        if re is None or im is None:
            raise ValueError("give both re and im")
        r, i = _f64(re), _f64(im)
    else:
        z = np.asarray(x)
        r = _f64(z.real)
        i = _f64(z.imag) if np.iscomplexobj(z) else np.zeros_like(r)
    if r.shape != i.shape:
        raise ValueError("re and im must have the same shape")
    return r, i


def _check(func: str, status: int) -> None:
    if status != 0:
        msg = _load().es_status_string(status).decode()
        raise NativeError(func, status, msg)


# --- API --------------------------------------------------------------------------------------


def hann(n: int) -> np.ndarray:
    """Symmetric Hann window of length n."""
    lib = _load()
    w = np.empty(n, dtype=np.float64)
    _check("es_hann", lib.es_hann(_ptr(w), n))
    return w


def fft(x, inverse: bool = False) -> np.ndarray:
    """Radix-2 FFT of a 1-D complex array (length must be a power of two). Inverse scales by 1/n."""
    lib = _load()
    re, im = _split(x)
    re, im = re.copy(), im.copy()
    if re.ndim != 1:
        raise ValueError("fft expects a 1-D array; use fft_batch for rows")
    _check("es_fft", lib.es_fft(_ptr(re), _ptr(im), re.size, int(inverse)))
    return re + 1j * im


def fft_batch(x, inverse: bool = False) -> np.ndarray:
    """Row-wise FFT of a 2-D complex array (rows x n)."""
    lib = _load()
    re, im = _split(x)
    re, im = re.copy(), im.copy()
    if re.ndim != 2:
        raise ValueError("fft_batch expects a 2-D array")
    rows, n = re.shape
    _check("es_fft_batch", lib.es_fft_batch(_ptr(re), _ptr(im), rows, n, int(inverse)))
    return re + 1j * im


def doppler_spectrum(x, nfft: int) -> np.ndarray:
    """Doppler power spectrum (dB, fft-shifted) of a 1-D complex series."""
    lib = _load()
    re, im = _split(x)
    out = np.empty(nfft, dtype=np.float64)
    _check(
        "es_doppler_spectrum",
        lib.es_doppler_spectrum(_ptr(re), _ptr(im), re.size, nfft, _ptr(out)),
    )
    return out


def doppler_spectrum_batch(x, nfft: int) -> np.ndarray:
    """Doppler spectra of each row of a 2-D complex array (rows x n) -> rows x nfft."""
    lib = _load()
    re, im = _split(x)
    if re.ndim != 2:
        raise ValueError("doppler_spectrum_batch expects a 2-D array")
    rows, n = re.shape
    out = np.empty((rows, nfft), dtype=np.float64)
    _check(
        "es_doppler_spectrum_batch",
        lib.es_doppler_spectrum_batch(_ptr(re), _ptr(im), rows, n, nfft, _ptr(out)),
    )
    return out


def sanitize_packets(h, x) -> dict[str, np.ndarray]:
    """Linear phase sanitization.

    h: complex array [M, K] (one packet) or [P, M, K]. x: K subcarrier offsets.
    Returns dict with 'csi' (complex, same shape as h), 'phase' (sanitized unwrapped phase),
    'slope', 'intercept' and 'ref' (reference antenna, -1 if none) per packet.
    """
    lib = _load()
    re, im = _split(h)
    single = re.ndim == 2
    if single:
        re, im = re[None], im[None]
    if re.ndim != 3:
        raise ValueError("h must be [M, K] or [P, M, K]")
    P, M, K = re.shape
    xs = _f64(x)
    if xs.shape != (K,):
        raise ValueError("x must have K elements")
    ore, oim, oph = (np.empty_like(re) for _ in range(3))
    slope, icpt = np.empty(P), np.empty(P)
    ref = np.empty(P, dtype=np.int32)
    _check(
        "es_sanitize_packets",
        lib.es_sanitize_packets(
            _ptr(re), _ptr(im), P, M, K, _ptr(xs), _ptr(ore), _ptr(oim), _ptr(oph),
            _ptr(slope), _ptr(icpt), _ptr(ref, ctypes.c_int32),
        ),
    )
    out = {"csi": ore + 1j * oim, "phase": oph, "slope": slope, "intercept": icpt, "ref": ref}
    if single:
        out = {k: v[0] for k, v in out.items()}
    return out


def hampel(x, half_window: int, n_sigma: float) -> tuple[np.ndarray, int]:
    """Hampel filter. Returns (filtered series, number of replaced samples)."""
    lib = _load()
    xs = _f64(x).ravel()
    y = np.empty_like(xs)
    replaced = _SZ(0)
    _check(
        "es_hampel",
        lib.es_hampel(_ptr(xs), xs.size, half_window, float(n_sigma), _ptr(y), ctypes.byref(replaced)),
    )
    return y, int(replaced.value)


def norm_cdf(x) -> np.ndarray | float:
    """Standard normal CDF using the same A&S erf approximation as the TypeScript engine."""
    lib = _load()
    if np.isscalar(x):
        return float(lib.es_norm_cdf(float(x)))
    xs = _f64(x)
    return np.vectorize(lambda v: lib.es_norm_cdf(float(v)), otypes=[np.float64])(xs)


def _rti_operator(pi, null_std, var_ratio):
    P = _f64(pi)
    if P.ndim != 2:
        raise ValueError("pi must be V x L")
    V, L = P.shape
    sd, vr = _f64(null_std), _f64(var_ratio)
    if sd.shape != (V,) or vr.shape != (V,):
        raise ValueError("null_std and var_ratio must have V elements")
    return P, sd, vr, V, L


def rti_apply(pi, null_std, var_ratio, y, z0: float) -> dict[str, np.ndarray]:
    """x = Pi y, z = x / null_std, occupancy = Phi(z - z0) (0.5 where var_ratio > 0.95)."""
    lib = _load()
    P, sd, vr, V, L = _rti_operator(pi, null_std, var_ratio)
    ys = _f64(y)
    if ys.shape != (L,):
        raise ValueError("y must have L elements")
    img, z, occ = np.empty(V), np.empty(V), np.empty(V)
    _check(
        "es_rti_apply",
        lib.es_rti_apply(_ptr(P), _ptr(sd), _ptr(vr), V, L, _ptr(ys), float(z0), _ptr(img), _ptr(z), _ptr(occ)),
    )
    return {"image": img, "z": z, "occupancy": occ}


def rti_apply_batch(pi, null_std, var_ratio, y, z0: float) -> dict[str, np.ndarray]:
    """Batched rti_apply: y is frames x L, outputs frames x V."""
    lib = _load()
    P, sd, vr, V, L = _rti_operator(pi, null_std, var_ratio)
    ys = _f64(y)
    if ys.ndim != 2 or ys.shape[1] != L:
        raise ValueError("y must be frames x L")
    F = ys.shape[0]
    img, z, occ = np.empty((F, V)), np.empty((F, V)), np.empty((F, V))
    _check(
        "es_rti_apply_batch",
        lib.es_rti_apply_batch(
            _ptr(P), _ptr(sd), _ptr(vr), V, L, _ptr(ys), F, float(z0), _ptr(img), _ptr(z), _ptr(occ)
        ),
    )
    return {"image": img, "z": z, "occupancy": occ}


def backprojection(tau, dyn, norm, f0: float, df: float, link_valid=None, antennas=None) -> np.ndarray:
    """Coherent delay-and-sum back-projection.

    tau: V x L x Mmax delays (s). dyn: complex L x Mmax x K dynamic CSI (NaN real part = skip).
    norm: L normalisers. link_valid: optional L booleans. antennas: optional L antenna counts.
    """
    lib = _load()
    t = _f64(tau)
    if t.ndim != 3:
        raise ValueError("tau must be V x L x Mmax")
    V, L, Mmax = t.shape
    re, im = _split(dyn)
    if re.ndim != 3 or re.shape[:2] != (L, Mmax):
        raise ValueError("dyn must be L x Mmax x K")
    K = re.shape[2]
    nrm = _f64(norm)
    if nrm.shape != (L,):
        raise ValueError("norm must have L elements")
    valid = None if link_valid is None else np.ascontiguousarray(link_valid, dtype=np.uint8)
    ants = None if antennas is None else np.ascontiguousarray(antennas, dtype=np.int32)
    for name, arr in (("link_valid", valid), ("antennas", ants)):
        if arr is not None and arr.shape != (L,):
            raise ValueError(f"{name} must have L elements")
    out = np.empty(V)
    _check(
        "es_backprojection",
        lib.es_backprojection(
            _ptr(t), V, L, Mmax, K, _ptr(re), _ptr(im),
            _ptr(valid, ctypes.c_uint8), _ptr(ants, ctypes.c_int32),
            _ptr(nrm), float(f0), float(df), _ptr(out),
        ),
    )
    return out
