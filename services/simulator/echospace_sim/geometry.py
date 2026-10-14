"""Small 3-vector helpers on plain tuples (port of packages/engine/src/sim/geometry.ts)."""

from __future__ import annotations

import math
from collections.abc import Sequence

C_LIGHT = 299_792_458.0

Vec3 = tuple[float, float, float]
VecLike = Sequence[float]


def sub(a: VecLike, b: VecLike) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a: VecLike, b: VecLike) -> Vec3:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scale(a: VecLike, s: float) -> Vec3:
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a: VecLike, b: VecLike) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def norm(a: VecLike) -> float:
    return math.sqrt(dot(a, a))


def dist(a: VecLike, b: VecLike) -> float:
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    dz = a[2] - b[2]
    return math.sqrt(dx * dx + dy * dy + dz * dz)


def segment_box_overlap(p0: VecLike, p1: VecLike, lo: VecLike, hi: VecLike) -> float:
    """Length of segment p0→p1 that lies inside the axis-aligned box, metres (0 when disjoint)."""
    t0 = 0.0
    t1 = 1.0
    for a in range(3):
        d = p1[a] - p0[a]
        if abs(d) < 1e-12:
            if p0[a] < lo[a] or p0[a] > hi[a]:
                return 0.0
            continue
        ta = (lo[a] - p0[a]) / d
        tb = (hi[a] - p0[a]) / d
        if ta > tb:
            ta, tb = tb, ta
        if ta > t0:
            t0 = ta
        if tb < t1:
            t1 = tb
        if t0 >= t1:
            return 0.0
    return (t1 - t0) * dist(p0, p1)


def segment_segment_distance(p0: VecLike, p1: VecLike, q0: VecLike, q1: VecLike) -> tuple[float, float]:
    """Closest distance between segment [p0,p1] and segment [q0,q1].

    Returns the distance and the parameter s along [p0,p1] of the closest point.
    """
    u = sub(p1, p0)
    v = sub(q1, q0)
    w = sub(p0, q0)
    a = dot(u, u)
    b = dot(u, v)
    c = dot(v, v)
    d = dot(u, w)
    e = dot(v, w)
    D = a * c - b * b
    sD = D
    tD = D
    if D < 1e-12:
        sN = 0.0
        sD = 1.0
        tN = e
        tD = c
    else:
        sN = b * e - c * d
        tN = a * e - b * d
        if sN < 0:
            sN = 0.0
            tN = e
            tD = c
        elif sN > sD:
            sN = sD
            tN = e + b
            tD = c
    if tN < 0:
        tN = 0.0
        if -d < 0:
            sN = 0.0
        elif -d > a:
            sN = sD
        else:
            sN = -d
            sD = a
    elif tN > tD:
        tN = tD
        if -d + b < 0:
            sN = 0.0
        elif -d + b > a:
            sN = sD
        else:
            sN = -d + b
            sD = a
    sc = 0.0 if abs(sN) < 1e-12 else sN / sD
    tc = 0.0 if abs(tN) < 1e-12 else tN / tD
    dP = sub(add(w, scale(u, sc)), scale(v, tc))
    return norm(dP), sc


def clamp(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def js_round(x: float) -> int:
    """JavaScript ``Math.round``: halves round towards +inf (Python's ``round`` rounds half to even)."""
    return math.floor(x + 0.5)


def js_hypot(*values: float) -> float:
    """``Math.hypot`` as implemented by V8: scale by the largest magnitude, Kahan-sum the squares.

    Python's ``math.hypot`` is more accurate but can differ in the last bit; the reference uses this
    where a result feeds a hard threshold (ellipse support, kernel truncation) so the decision is
    reproduced exactly.
    """
    mx = 0.0
    for v in values:
        a = abs(v)
        if math.isinf(a):
            return math.inf
        if a > mx or math.isnan(a):
            mx = a
    if math.isnan(mx):
        return math.nan
    if mx == 0:
        return 0.0
    total = 0.0
    comp = 0.0
    for v in values:
        n = abs(v) / mx
        summand = n * n - comp
        prelim = total + summand
        comp = (prelim - total) - summand
        total = prelim
    return math.sqrt(total) * mx
