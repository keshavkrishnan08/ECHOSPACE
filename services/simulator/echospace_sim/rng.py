"""Deterministic 32-bit PRNG (xoshiro128**) seeded through splitmix32.

Bit-exact port of packages/engine/src/sim/rng.ts. Floats are derived as u32 / 2^32, normals with
Box-Muller consuming two uniforms per sample, so a given seed yields the same stream in both engines.
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
        """Standard normal via Box-Muller (cosine branch only, two uniforms per call)."""
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


class RngBank:
    """Many independent xoshiro128** streams advanced in lockstep with NumPy.

    Each lane yields exactly the sequence of the scalar :class:`Rng` with the same seed; the
    bank only changes how the numbers are produced (a block of draws for all lanes at a time),
    which removes the per-draw interpreter overhead when one stream per link is needed.
    Lanes are consumed independently: a lane that runs out triggers a refill of every lane,
    and unconsumed draws are kept, so the per-lane order is preserved under any access pattern.
    """

    def __init__(self, seeds: list[int], block: int = 4096) -> None:
        import numpy as np

        self._np = np
        scalar = [Rng(s) for s in seeds]
        self._s = np.array([[r.s0, r.s1, r.s2, r.s3] for r in scalar], dtype=np.uint32).T.copy()
        self._block = block
        self.lanes = [RngLane(self, i) for i in range(len(seeds))]

    def _generate(self) -> list[list[int]]:
        np = self._np
        s0, s1, s2, s3 = (x.copy() for x in self._s)
        n = self._block
        out = np.empty((n, s0.size), dtype=np.uint32)
        five, nine = np.uint32(5), np.uint32(9)
        u7, u25, u9, u11, u21 = (np.uint32(v) for v in (7, 25, 9, 11, 21))
        for i in range(n):
            x = s1 * five
            out[i] = ((x << u7) | (x >> u25)) * nine
            t = s1 << u9
            s2 ^= s0
            s3 ^= s1
            s1 ^= s2
            s0 ^= s3
            s2 ^= t
            s3 = (s3 << u11) | (s3 >> u21)
        self._s = np.stack([s0, s1, s2, s3])
        cols: list[list[int]] = out.T.tolist()
        return cols

    def _refill(self) -> None:
        for lane, fresh in zip(self.lanes, self._generate(), strict=True):
            lane._buf = lane._buf[lane._pos :] + fresh
            lane._pos = 0


class RngLane:
    """One stream of an :class:`RngBank`; same interface and outputs as :class:`Rng`."""

    __slots__ = ("_bank", "_buf", "_pos", "index")

    def __init__(self, bank: RngBank, index: int) -> None:
        self._bank = bank
        self._buf: list[int] = []
        self._pos = 0
        self.index = index

    def _take(self, n: int) -> list[int]:
        while self._pos + n > len(self._buf):
            self._bank._refill()
        out = self._buf[self._pos : self._pos + n]
        self._pos += n
        return out

    def next_u32(self) -> int:
        return self._take(1)[0]

    def uniform(self) -> float:
        return self._take(1)[0] / _TWO_POW_32

    def normal(self) -> float:
        r1, r2 = self._take(2)
        u1 = 1 - r1 / _TWO_POW_32
        return math.sqrt(-2 * math.log(u1)) * math.cos(_TWO_PI * (r2 / _TWO_POW_32))

    def normals(self, n: int) -> list[float]:
        raw = self._take(2 * n)
        sqrt, log, cos = math.sqrt, math.log, math.cos
        return [
            sqrt(-2 * log(1 - raw[2 * i] / _TWO_POW_32)) * cos(_TWO_PI * (raw[2 * i + 1] / _TWO_POW_32))
            for i in range(n)
        ]
