"""Scenario configuration models.

Pydantic mirror of the zod schemas in packages/schemas/src/{scene,scenario}.ts. Field names are
snake_case in Python and camelCase on the wire (aliases), so a config serialized by the TypeScript
engine validates here unchanged and ``model_dump(by_alias=True)`` round-trips back to it.
Defaults and bounds are identical to the zod definitions.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Vec3 = tuple[float, float, float]
Vec2 = tuple[float, float]

Material = Literal["drywall", "wood", "glass", "brick", "concrete", "metal", "fabric"]
ObstacleKind = Literal["table", "sofa", "cabinet", "shelf", "partition", "bed", "desk", "box"]
WallSide = Literal["south", "east", "north", "west"]
SensorRole = Literal["tx", "rx", "trx"]
ReconModelId = Literal["rti-bayes", "bp-dsb", "ridge-floor", "tcn-encoder", "transformer-encoder"]
TemporalFilter = Literal["none", "ema", "kalman", "learned"]
ScenarioKey = Literal["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "custom"]
StageId = Literal[
    "validate",
    "align",
    "buffer",
    "estimate",
    "preprocess",
    "filter",
    "features",
    "spatial",
    "inference",
    "reconstruct",
    "associate",
    "serialize",
]

SCENARIO_SCHEMA_VERSION: Literal[1] = 1

# Simplified single-number penetration losses (dB) for the 5 GHz band. Placeholders, not measurements.
MATERIAL_PENETRATION_DB: dict[str, float] = {
    "fabric": 1,
    "glass": 2,
    "wood": 3,
    "drywall": 4,
    "brick": 8,
    "concrete": 15,
    "metal": 30,
}

# Amplitude reflection coefficient used for first-order specular reflections.
MATERIAL_REFLECTIVITY: dict[str, float] = {
    "fabric": 0.05,
    "glass": 0.25,
    "wood": 0.2,
    "drywall": 0.3,
    "brick": 0.4,
    "concrete": 0.5,
    "metal": 0.9,
}


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    def to_json_dict(self) -> dict[str, Any]:
        """Serialized with the camelCase field names used by the TypeScript engine."""
        return self.model_dump(by_alias=True, mode="json")


class Room(Model):
    width: float = Field(ge=2, le=20)
    depth: float = Field(ge=2, le=20)
    height: float = Field(ge=2, le=6)
    wall_material: Material = "drywall"
    wall_thickness: float = Field(default=0.12, ge=0.05, le=0.6)
    wall_reflectivity: float | None = Field(default=None, ge=0, le=1)
    """Overrides the material reflectivity when set (Scenario D)."""


class Obstacle(Model):
    id: str = Field(min_length=1)
    kind: ObstacleKind
    min: Vec3
    max: Vec3
    material: Material
    attenuation_db: float | None = Field(default=None, ge=0, le=60)
    """Optional explicit penetration loss in dB, overriding the material default."""


class Opening(Model):
    id: str = Field(min_length=1)
    kind: Literal["door", "window"]
    wall: WallSide
    offset: float = Field(ge=0)
    """Distance along the wall from its start corner to the opening centre, metres."""
    width: float = Field(ge=0.3, le=4)
    height: float = Field(ge=0.3, le=3)
    sill: float = Field(default=0, ge=0, le=2.5)


class SensorNode(Model):
    id: str = Field(min_length=1)
    label: str = ""
    role: SensorRole
    position: Vec3
    yaw_deg: float = Field(ge=-360, le=360)
    """Boresight heading in degrees, counter-clockwise from +x. Rx arrays are perpendicular to boresight."""
    antennas: int = Field(default=3, ge=1, le=4)
    """Receive antennas in a uniform linear array with half-wavelength spacing."""
    enabled: bool = True


class WalkAction(Model):
    type: Literal["walk"]
    to: Vec2
    speed: float = Field(default=1.0, ge=0.1, le=3)


class StopAction(Model):
    type: Literal["stop"]
    duration_s: float = Field(ge=0, le=120)


class TurnAction(Model):
    type: Literal["turn"]
    heading_deg: float
    duration_s: float = Field(default=1, ge=0.1, le=10)


class SitAction(Model):
    type: Literal["sit"]
    duration_s: float = Field(ge=0, le=120)


MotionAction = Annotated[WalkAction | StopAction | TurnAction | SitAction, Field(discriminator="type")]


class SubjectSpec(Model):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    """Synthetic, non-identifying label such as "S1"."""
    height_m: float = Field(default=1.75, ge=1, le=2.2)
    radius_m: float = Field(default=0.22, ge=0.1, le=0.4)
    rcs_m2: float = Field(default=1.0, ge=0.05, le=5)
    """Bistatic radar cross-section in m^2 used by the scatter model (normalized, not calibrated)."""
    start: Vec2
    start_heading_deg: float = 0
    start_delay_s: float = Field(default=0, ge=0)
    actions: list[MotionAction] = Field(default_factory=list)
    loop: bool = True


class SignalConfig(Model):
    center_freq_hz: float = Field(default=5.32e9, ge=2.4e9, le=7.2e9)
    bandwidth_hz: float = Field(default=40e6, ge=20e6, le=160e6)
    subcarriers: int = Field(default=30, ge=8, le=128)
    packet_rate_hz: float = Field(default=100, ge=10, le=1000)
    snr_db: float = Field(default=25, ge=-10, le=50)
    """Ratio of mean static channel power to complex noise power per sample, dB."""
    max_reflection_order: int = Field(default=1, ge=0, le=1)
    reflecting_surfaces: int = Field(default=6, ge=0, le=6)
    """Number of the room's six surfaces that produce reflections (ordered: 4 walls, floor, ceiling)."""
    subject_scatter: bool = True
    subject_shadowing: bool = True
    body_shadow_db: float = Field(default=8, ge=0, le=20)
    """Peak body shadowing loss on a path passing through the body axis, dB."""


class AntennaFault(Model):
    sensor_id: str
    antenna: int = Field(ge=0)


class ImpairmentConfig(Model):
    packet_loss: float = Field(default=0.01, ge=0, le=0.95)
    burst_rate_hz: float = Field(default=0, ge=0, le=5)
    """Expected number of burst dropouts per link per second."""
    burst_length_packets: int = Field(default=20, ge=1, le=500)
    timestamp_jitter_ms: float = Field(default=0.5, ge=0, le=50)
    missing_timestamp_prob: float = Field(default=0, ge=0, le=1)
    phase_instability_rad: float = Field(default=0.02, ge=0, le=3.2)
    """Std-dev of per-antenna random phase that cannot be removed by sanitization, radians."""
    cfo: bool = True
    sto: bool = True
    agc_sigma_db: float = Field(default=0.2, ge=0, le=6)
    """Std-dev of per-packet automatic gain control error, in dB."""
    missing_antennas: list[AntennaFault] = Field(default_factory=list)


class HampelConfig(Model):
    enabled: bool = True
    half_window: int = Field(default=3, ge=1, le=10)
    n_sigma: float = Field(default=3, ge=1, le=6)


class LowpassConfig(Model):
    enabled: bool = True
    alpha: float = Field(default=0.5, ge=0.01, le=1)
    """Exponential smoothing factor applied to per-link RSS features."""


class DspConfig(Model):
    frame_rate_hz: float = Field(default=10, ge=1, le=30)
    buffer_seconds: float = Field(default=2.56, ge=0.5, le=10)
    calibration_seconds: float = Field(default=3, ge=0.5, le=30)
    phase_sanitize: bool = True
    hampel: HampelConfig = Field(default_factory=HampelConfig)
    lowpass: LowpassConfig = Field(default_factory=LowpassConfig)


class ReconConfig(Model):
    model_config = ConfigDict(protected_namespaces=())

    model_id: ReconModelId = "rti-bayes"
    voxel_size_m: float = Field(default=0.25, ge=0.15, le=0.6)
    detection_z: float = Field(default=4, ge=0, le=10)
    """Detection threshold z0 on the null-hypothesis z-score of the posterior-mean attenuation density.

    Occupancy is reported as Phi(z - z0): a detection confidence, not a calibrated posterior probability.
    """
    occupancy_threshold: float = Field(default=0.6, ge=0.05, le=0.99)
    confidence_threshold: float = Field(default=0.1, ge=0, le=1)
    temporal_smoothing: float = Field(default=0.5, ge=0, le=0.98)
    spatial_filter: bool = True
    ellipse_excess_m: float = Field(default=0.12, ge=0.02, le=1)
    prior_std: float = Field(default=1.0, ge=0.05, le=10)
    prior_correlation_m: float = Field(default=0.35, ge=0.05, le=3)
    noise_std_db: float = Field(default=1.0, ge=0.05, le=10)
    kernel_cutoff: float = Field(default=4, ge=1, le=8)
    """Correlation kernel truncation radius in multiples of prior_correlation_m."""
    max_points: int = Field(default=6000, ge=100, le=50000)
    outlier_removal: bool = True


class TrackingConfig(Model):
    enabled: bool = True
    filter: TemporalFilter = "kalman"
    ema_alpha: float = Field(default=0.35, ge=0.01, le=1)
    process_noise: float = Field(default=1.5, ge=0.001, le=50)
    """Kalman white-acceleration spectral density, m^2/s^3."""
    measurement_std_m: float = Field(default=0.35, ge=0.01, le=3)
    """Detection position std-dev, metres."""
    gate_m: float = Field(default=1.2, ge=0.2, le=5)
    birth_hits: int = Field(default=3, ge=1, le=20)
    max_misses: int = Field(default=8, ge=1, le=100)
    detection_threshold: float = Field(default=0.55, ge=0.05, le=0.99)
    max_detections: int = Field(default=4, ge=1, le=10)


class PrivacyConfig(Model):
    mode: Literal["standard", "coarse"] = "standard"
    show_skeleton: bool = True
    track_history_seconds: float = Field(default=10, ge=0, le=120)


class PipelineConfig(Model):
    queue_depth: int = Field(default=256, ge=1, le=4096)
    drop_policy: Literal["drop-oldest", "drop-newest"] = "drop-oldest"
    max_in_flight_frames: int = Field(default=2, ge=1, le=16)
    """Maximum frames in flight to the presentation layer before the engine drops frames."""
    injected_inference_delay_ms: float = Field(default=0, ge=0, le=2000)
    bypass: dict[StageId, bool] = Field(default_factory=dict)


class ScenarioConfig(Model):
    schema_version: Literal[1] = SCENARIO_SCHEMA_VERSION
    scenario: ScenarioKey
    name: str = Field(min_length=1)
    seed: int = Field(ge=0, le=0xFFFFFFFF)
    duration_s: float = Field(default=60, ge=5, le=3600)
    room: Room
    obstacles: list[Obstacle] = Field(default_factory=list)
    openings: list[Opening] = Field(default_factory=list)
    sensors: list[SensorNode] = Field(min_length=2)
    subjects: list[SubjectSpec] = Field(default_factory=list)
    signal: SignalConfig
    impairments: ImpairmentConfig
    dsp: DspConfig
    recon: ReconConfig
    tracking: TrackingConfig
    privacy: PrivacyConfig
    pipeline: PipelineConfig


def parse_scenario(data: Any) -> ScenarioConfig:
    """Validates a camelCase (TypeScript) or snake_case scenario dictionary."""
    return ScenarioConfig.model_validate(data)
