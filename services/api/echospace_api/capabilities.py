"""Runtime capability probes reported by /api/health and /api/diagnostics."""

from __future__ import annotations

import ctypes
import importlib
import logging
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


@lru_cache
def gpu_info() -> dict[str, Any]:
    """CUDA GPU availability via PyTorch if installed, else NVML; ``available`` False otherwise."""
    try:
        torch = importlib.import_module("torch")
    except ImportError:
        torch = None
    if torch is not None:
        try:
            if torch.cuda.is_available():
                return {
                    "available": True,
                    "via": "torch",
                    "devices": [torch.cuda.get_device_name(i) for i in range(torch.cuda.device_count())],
                }
        except Exception as e:  # driver problems surface here
            log.debug("torch CUDA probe failed: %s", e)
    for name in ("libnvidia-ml.so.1", "libnvidia-ml.so", "nvml.dll"):
        try:
            nvml = ctypes.CDLL(name)
        except OSError:
            continue
        try:
            if nvml.nvmlInit_v2() != 0:
                continue
            count = ctypes.c_uint(0)
            ok = nvml.nvmlDeviceGetCount_v2(ctypes.byref(count)) == 0 and count.value > 0
            nvml.nvmlShutdown()
            if ok:
                return {"available": True, "via": "nvml", "devices": count.value}
        except (AttributeError, OSError) as e:
            log.debug("NVML probe failed: %s", e)
    return {"available": False, "via": None, "devices": []}


@lru_cache
def native_dsp_info(native_dir: str) -> dict[str, Any]:
    """Whether engine/python/echospace_native imports and its shared library loads."""
    path = Path(native_dir)
    if path.is_dir() and str(path) not in sys.path:
        sys.path.append(str(path))
    try:
        native = importlib.import_module("echospace_native")
    except ImportError as e:
        return {"available": False, "reason": f"echospace_native not importable: {e}"}
    try:
        if native.available():
            return {"available": True, "library": str(native.library_path()), "abiVersion": native.abi_version()}
        return {"available": False, "reason": "shared library not built or not loadable"}
    except Exception as e:
        return {"available": False, "reason": f"{type(e).__name__}: {e}"}
