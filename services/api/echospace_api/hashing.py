"""Canonical JSON and the FNV-1a config hash used by the TypeScript engine.

``canonical_json`` reproduces ``canonicalJson`` in packages/engine/src/sim/scene.ts (sorted keys,
no whitespace, JavaScript number formatting) and ``stable_hash`` reproduces ``stableHash``, so a
configuration hashed here gets the same ``configHash`` as in the browser.
"""

from __future__ import annotations

import hashlib
import json
import math
from decimal import Decimal
from typing import Any


def js_number(x: float | int) -> str:
    """ECMAScript Number::toString for finite numbers (JSON.stringify writes null otherwise)."""
    if isinstance(x, bool):
        return "true" if x else "false"
    if isinstance(x, int):
        return str(x)
    if not math.isfinite(x):
        return "null"
    if x == 0:
        return "0"
    sign = "-" if x < 0 else ""
    _, digits_t, exp = Decimal(repr(abs(x))).normalize().as_tuple()
    digits = "".join(map(str, digits_t))
    k = len(digits)
    n = k + int(exp)
    if k <= n <= 21:
        s = digits + "0" * (n - k)
    elif 0 < n <= 21:
        s = digits[:n] + "." + digits[n:]
    elif -6 < n <= 0:
        s = "0." + "0" * (-n) + digits
    else:
        e = n - 1
        mant = digits if k == 1 else digits[0] + "." + digits[1:]
        s = f"{mant}e{'+' if e >= 0 else '-'}{abs(e)}"
    return sign + s


def canonical_json(value: Any) -> str:
    if value is None or isinstance(value, bool):
        return json.dumps(value)
    if isinstance(value, int | float):
        return js_number(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list | tuple):
        return "[" + ",".join(canonical_json(v) for v in value) + "]"
    if isinstance(value, dict):
        return (
            "{"
            + ",".join(f"{json.dumps(k, ensure_ascii=False)}:{canonical_json(value[k])}" for k in sorted(value))
            + "}"
        )
    raise TypeError(f"cannot canonicalize {type(value).__name__}")


def stable_hash(value: Any) -> str:
    """32-bit FNV-1a over the UTF-16 code units of the canonical JSON, as 8 hex digits."""
    data = canonical_json(value).encode("utf-16-le")
    h = 0x811C9DC5
    for i in range(0, len(data), 2):
        h ^= data[i] | (data[i + 1] << 8)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()
