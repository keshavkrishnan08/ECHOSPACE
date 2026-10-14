"""Scene geometry: links, antenna arrays, room surfaces and the voxel grid (port of sim/scene.ts)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt

from .config import MATERIAL_REFLECTIVITY, Opening, Room, ScenarioConfig, SensorNode
from .geometry import C_LIGHT, Vec3, dist, js_round

SurfaceName = Literal["south", "east", "north", "west", "floor", "ceiling"]


def wavelength(center_freq_hz: float) -> float:
    return C_LIGHT / center_freq_hz


@dataclass(frozen=True)
class LinkDescriptor:
    index: int
    id: str
    tx_id: str
    rx_id: str
    tx: Vec3
    rx: Vec3
    length_m: float
    antennas: int


def _can_tx(s: SensorNode) -> bool:
    return s.role in ("tx", "trx")


def _can_rx(s: SensorNode) -> bool:
    return s.role in ("rx", "trx")


def build_links(sensors: list[SensorNode]) -> list[LinkDescriptor]:
    """Enumerates directed Tx→Rx links. A pair of transceivers forms a single link (lower index transmits)."""
    active = [s for s in sensors if s.enabled]
    links: list[LinkDescriptor] = []
    for i, a in enumerate(active):
        for j, b in enumerate(active):
            if i == j or not _can_tx(a) or not _can_rx(b):
                continue
            if a.role == "trx" and b.role == "trx" and j < i:
                continue
            links.append(
                LinkDescriptor(
                    index=len(links),
                    id=f"{a.id}>{b.id}",
                    tx_id=a.id,
                    rx_id=b.id,
                    tx=a.position,
                    rx=b.position,
                    length_m=dist(a.position, b.position),
                    antennas=b.antennas,
                )
            )
    return links


def antenna_positions(sensor: SensorNode, lam: float) -> list[Vec3]:
    """Receiver element positions: uniform linear array, λ/2 spacing, perpendicular to boresight."""
    yaw = (sensor.yaw_deg * math.pi) / 180
    ax = -math.sin(yaw)
    ay = math.cos(yaw)
    m0 = (sensor.antennas - 1) / 2
    px, py, pz = sensor.position
    out: list[Vec3] = []
    for m in range(sensor.antennas):
        o = (m - m0) * (lam / 2)
        out.append((px + ax * o, py + ay * o, pz))
    return out


@dataclass(frozen=True)
class Surface:
    name: SurfaceName
    axis: int
    """Axis normal to the surface (0, 1 or 2) and its coordinate."""
    value: float
    reflectivity: float


def room_surfaces(room: Room) -> list[Surface]:
    """Room surfaces in a fixed order: south, east, north, west, floor, ceiling."""
    g = room.wall_reflectivity if room.wall_reflectivity is not None else MATERIAL_REFLECTIVITY[room.wall_material]
    return [
        Surface("south", 1, 0.0, g),
        Surface("east", 0, room.width, g),
        Surface("north", 1, room.depth, g),
        Surface("west", 0, 0.0, g),
        Surface("floor", 2, 0.0, min(1.0, g * 1.2)),
        Surface("ceiling", 2, room.height, g * 0.8),
    ]


def mirror(p: Vec3, s: Surface) -> Vec3:
    q = list(p)
    q[s.axis] = 2 * s.value - p[s.axis]
    return (q[0], q[1], q[2])


def opening_reflectivity(openings: list[Opening], s: Surface, hit: Vec3, base: float) -> float:
    """Reflectivity at a wall hit point, accounting for doors (open) and windows (glass)."""
    if s.axis == 2:
        return base
    for o in openings:
        if o.wall != s.name:
            continue
        along = hit[0] if s.name in ("south", "north") else hit[1]
        if abs(along - o.offset) <= o.width / 2 and o.sill <= hit[2] <= o.sill + o.height:
            return 0.0 if o.kind == "door" else MATERIAL_REFLECTIVITY["glass"]
    return base


@dataclass(frozen=True)
class VoxelGrid:
    nx: int
    ny: int
    nz: int
    size: float
    origin: Vec3
    count: int
    centers: npt.NDArray[np.float64]
    """Voxel centres, shape (count, 3), x fastest then y then z."""


def build_grid(room: Room, voxel_size: float) -> VoxelGrid:
    nx = max(1, js_round(room.width / voxel_size))
    ny = max(1, js_round(room.depth / voxel_size))
    nz = max(1, js_round(room.height / voxel_size))
    sx = room.width / nx
    sy = room.depth / ny
    sz = room.height / nz
    k, j, i = np.meshgrid(np.arange(nz), np.arange(ny), np.arange(nx), indexing="ij")
    centers = np.stack([(i.ravel() + 0.5) * sx, (j.ravel() + 0.5) * sy, (k.ravel() + 0.5) * sz], axis=1)
    return VoxelGrid(nx, ny, nz, voxel_size, (0.0, 0.0, 0.0), nx * ny * nz, centers)


def grid_spacing(g: VoxelGrid) -> tuple[float, float, float]:
    """Centre-to-centre spacing per axis, computed from the centres exactly as the TypeScript engine does."""
    c = g.centers
    sx = float(c[1, 0] - c[0, 0]) if g.nx > 1 else g.size
    sy = float(c[g.nx, 1] - c[0, 1]) if g.ny > 1 else g.size
    sz = float(c[g.nx * g.ny, 2] - c[0, 2]) if g.nz > 1 else g.size
    return sx, sy, sz


def sensor_by_id(config: ScenarioConfig, sensor_id: str) -> SensorNode:
    for s in config.sensors:
        if s.id == sensor_id:
            return s
    raise KeyError(f"unknown sensor {sensor_id}")
