import math

from echospace_sim.rng import STREAM, Rng, derive_seed, splitmix32

# Pinned in packages/engine/test/__snapshots__/rng.test.ts.snap as well.
REFERENCE_U32_SEED_12345 = [518667457, 440444462, 4232892992, 3757857622, 3939018813]


def test_matches_frozen_reference_stream() -> None:
    r = Rng(12345)
    assert [r.next_u32() for _ in range(5)] == REFERENCE_U32_SEED_12345


def test_deterministic_for_a_seed() -> None:
    a = Rng(42)
    b = Rng(42)
    assert [a.next_u32() for _ in range(100)] == [b.next_u32() for _ in range(100)]


def test_outputs_are_unsigned_32_bit() -> None:
    r = Rng(0)
    values = [r.next_u32() for _ in range(1000)]
    assert all(0 <= v <= 0xFFFFFFFF for v in values)
    value, state = splitmix32(0xFFFFFFFF)
    assert 0 <= value <= 0xFFFFFFFF and 0 <= state <= 0xFFFFFFFF


def test_uniform_range() -> None:
    r = Rng(3)
    u = [r.uniform() for _ in range(5000)]
    assert min(u) >= 0 and max(u) < 1


def test_batched_normals_equal_scalar_draws_and_state() -> None:
    a = Rng(99)
    b = Rng(99)
    assert a.normals(257) == [b.normal() for _ in range(257)]
    assert a.next_u32() == b.next_u32()


def test_roughly_standard_normals() -> None:
    xs = Rng(7).normals(20000)
    mean = sum(xs) / len(xs)
    var = sum(x * x for x in xs) / len(xs)
    assert abs(mean) < 0.03
    assert abs(var - 1) < 0.05
    assert all(math.isfinite(x) for x in xs)


def test_derive_seed_separates_streams() -> None:
    assert derive_seed(1, 1, 0) != derive_seed(1, 1, 1)
    assert derive_seed(1, 1, 0) == derive_seed(1, 1, 0)
    assert derive_seed(7, STREAM.impairments, 3) != derive_seed(7, STREAM.calibration, 3)
