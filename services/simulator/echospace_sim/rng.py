"""Deterministic 32-bit PRNG (xoshiro128**) seeded through splitmix32.

Bit-exact port of packages/engine/src/sim/rng.ts. Floats are derived as u32 / 2^32, normals with
Box–Muller consuming two uniforms per sample, so a given seed yields the same stream in both engines.
"""

from __future__ import annotations

import math
from enum import IntEnum

MASK32 = 0xFFFFFFFF
_TWO_POW_32 = 4294967296.0
_TWO_PI = 2 * math.pi


def splitmix32(state: int) -> tuple[int, int]:
    """Returns (value, next_state)."""
    nxt = (state + 0x9E3779B9) & MASK32
    z = nxt
    z = ((z ^ (z >> 16)) * 0x85EBCA6B) & MASK32
    z = ((z ^ (z >> 13)) * 0xC2B2AE35) & MASK32
    return (z ^ (z >> 16)) & MASK32, nxt


def derive_seed(seed: int, *parts: int) -> int:
    """Mixes a base seed with stream identifiers into an independent 32-bit seed."""
    state = seed & MASK32
    out, state = splitmix32(state)
    for p in parts:
        state = (state ^ (p & MASK32)) & MASK32
        out, state = splitmix32(state)
        state = (state ^ out) & MASK32
    return out


class Stream(IntEnum):
    """Stream identifiers. Keep in sync with the TypeScript implementation."""

    impairments = 1
    calibration = 2
    points = 3
    scenario = 4
    ghost = 5


STREAM = Stream


def _rotl(x: int, k: int) -> int:
    return ((x << k) | (x >> (32 - k))) & MASK32


class Rng:
    __slots__ = ("s0", "s1", "s2", "s3")

    def __init__(self, seed: int) -> None:
        state = seed & MASK32
        self.s0, state = splitmix32(state)
        self.s1, state = splitmix32(state)
        self.s2, state = splitmix32(state)
        self.s3, state = splitmix32(state)
        if (self.s0 | self.s1 | self.s2 | self.s3) == 0:
            self.s0 = 1

    def next_u32(self) -> int:
        s0, s1, s2, s3 = self.s0, self.s1, self.s2, self.s3
        result = (_rotl((s1 * 5) & MASK32, 7) * 9) & MASK32
        t = (s1 << 9) & MASK32
        s2 ^= s0
        s3 ^= s1
        s1 ^= s2
        s0 ^= s3
        s2 ^= t
        s3 = _rotl(s3, 11)
        self.s0, self.s1, self.s2, self.s3 = s0, s1, s2, s3
        return result

    def uniform(self) -> float:
        """Uniform in [0, 1)."""
        return self.next_u32() / _TWO_POW_32

    def normal(self) -> float:
        """Standard normal via Box–Muller (cosine branch only, two uniforms per call)."""
        u1 = 1 - self.uniform()
        u2 = self.uniform()
        return math.sqrt(-2 * math.log(u1)) * math.cos(_TWO_PI * u2)

    def normals(self, n: int) -> list[float]:
        """`n` consecutive calls to :meth:`normal`, with the generator state kept in locals.

        Produces exactly the same values and leaves the generator in the same state as calling
        :meth:`normal` n times; it exists because the channel simulator draws thousands per packet.
        """
        s0, s1, s2, s3 = self.s0, self.s1, self.s2, self.s3
        sqrt, log, cos = math.sqrt, math.log, math.cos
        out = [0.0] * n
        for i in range(n):
            x = (s1 * 5) & MASK32
            r1 = ((((x << 7) | (x >> 25)) & MASK32) * 9) & MASK32
            t = (s1 << 9) & MASK32
            s2 ^= s0
            s3 ^= s1
            s1 ^= s2
            s0 ^= s3
            s2 ^= t
            s3 = ((s3 << 11) | (s3 >> 21)) & MASK32

            x = (s1 * 5) & MASK32
            r2 = ((((x << 7) | (x >> 25)) & MASK32) * 9) & MASK32
            t = (s1 << 9) & MASK32
            s2 ^= s0
            s3 ^= s1
            s1 ^= s2
            s0 ^= s3
            s2 ^= t
            s3 = ((s3 << 11) | (s3 >> 21)) & MASK32

            u1 = 1 - r1 / _TWO_POW_32
            out[i] = sqrt(-2 * log(u1)) * cos(_TWO_PI * (r2 / _TWO_POW_32))
        self.s0, self.s1, self.s2, self.s3 = s0, s1, s2, s3
        return out
