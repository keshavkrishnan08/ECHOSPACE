"""Request / response models. JSON field names are camelCase to match the TypeScript schemas.

``ExperimentRecord`` mirrors the zod schema in packages/schemas/src/experiment.ts field by field
(same defaults and bounds; unknown keys are ignored as zod strips them). Scenario configurations
are validated with :class:`echospace_sim.config.ScenarioConfig`, the Python mirror of the zod
``ScenarioConfig``.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator
from pydantic.alias_generators import to_camel

from echospace_sim.config import ScenarioConfig

from .metrics_catalog import MetricDefinition

SourceMode = Literal["synthetic", "recorded", "hardware"]
EngineKind = Literal["browser-worker", "python-reference"]
ScenarioPresetKey = Literal["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="ignore")

    def dump(self) -> dict[str, Any]:
        return self.model_dump(by_alias=True, mode="json")


# --- experiments (mirror of packages/schemas/src/experiment.ts) -------------------------------


class MachineInfo(ApiModel):
    user_agent: str | None = None
    hardware_concurrency: float | None = None
    device_memory_gb: float | None = None
    platform: str | None = None
    gpu: str | None = None


class MetricSummary(ApiModel):
    id: str
    n: int = Field(ge=0)
    mean: float | None
    median: float | None
    p95: float | None
    min: float | None
    max: float | None
    last: float | None


class MetricSeries(ApiModel):
    id: str
    t: list[float]
    v: list[float | None]


class ExperimentEvent(ApiModel):
    t: float
    kind: str
    message: str


class ConfigChange(ApiModel):
    frame_seq: int = Field(ge=0)
    t: float
    config: ScenarioConfig


class ExperimentRecord(ApiModel):
    schema_version: Literal[1] = 1
    id: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=200)
    notes: str = Field(default="", max_length=5000)
    project_id: str = "default"
    source_mode: SourceMode
    config: ScenarioConfig
    config_hash: str
    model_id: str
    model_version: str
    preprocessing_version: str
    engine: EngineKind
    inference_device: str = "cpu"
    software_version: str
    machine: MachineInfo | None = None
    status: Literal["draft", "running", "completed", "failed", "cancelled"]
    started_at: str
    ended_at: str | None
    simulated_duration_s: float = Field(ge=0)
    frames: int = Field(ge=0)
    replay_digest: str | None = None
    """SHA-256 over a canonical digest of the first N frames, used to verify deterministic replay."""
    replay_digest_frames: int = Field(default=0, ge=0)
    live_run_reproducible: bool | None = None
    summaries: list[MetricSummary] = Field(default_factory=list)
    series: list[MetricSeries] = Field(default_factory=list)
    events: list[ExperimentEvent] = Field(default_factory=list)
    config_changes: list[ConfigChange] = Field(default_factory=list)
    """Mid-run reconfigurations, re-applied at the same frame during replay."""
    tags: list[str] = Field(default_factory=list)
    baseline_of: str | None = None


class ExperimentSummary(ApiModel):
    id: str
    name: str
    project_id: str
    source_mode: SourceMode
    engine: EngineKind
    model_id: str
    model_version: str
    status: str
    started_at: str
    ended_at: str | None
    simulated_duration_s: float
    frames: int
    config_hash: str
    scenario: str
    tags: list[str]
    summaries: list[MetricSummary]


class ExperimentCreated(ApiModel):
    id: str
    created: bool
    """False when an identical record with this id already existed (idempotent re-submission)."""
    payload_artifact: ArtifactOut


class ItemList(ApiModel):
    items: list[Any]


# --- projects / health -----------------------------------------------------------------------


class ProjectOut(ApiModel):
    id: str
    name: str
    description: str
    created_at: datetime
    role: str


class HealthCapabilities(ApiModel):
    websocket: bool
    python_reference_engine: bool
    gpu: bool
    native_dsp: bool


class HealthOut(ApiModel):
    status: Literal["ok"]
    version: str
    capabilities: HealthCapabilities
    database: Literal["sqlite", "postgresql"]
    object_store: Literal["local", "s3"]


# --- sessions --------------------------------------------------------------------------------


class SessionCreate(ApiModel):
    project_id: str = "default"
    source_mode: SourceMode
    config: ScenarioConfig
    authorized: bool = False
    """Operator confirmation that capture is authorized. Required (true) for hardware sessions."""
    consent_note: str = Field(default="", max_length=2000)
    """Who consented to what, for hardware capture. Required for hardware sessions."""
    pace: Literal["realtime", "max"] = "realtime"
    """realtime: one frame per frame period of wall time; max: as fast as the engine runs."""


class SimulationCreate(ApiModel):
    project_id: str = "default"
    scenario: ScenarioPresetKey | None = None
    config: ScenarioConfig | None = None
    seed: int | None = Field(default=None, ge=0, le=0xFFFFFFFF)
    pace: Literal["realtime", "max"] = "realtime"

    @model_validator(mode="after")
    def _one_source(self) -> SimulationCreate:
        if (self.scenario is None) == (self.config is None):
            raise ValueError("give exactly one of 'scenario' (preset key) or 'config'")
        return self


class SimulationRestart(ApiModel):
    seed: int | None = Field(default=None, ge=0, le=0xFFFFFFFF)


class SessionOut(ApiModel):
    id: str
    project_id: str
    source_mode: SourceMode
    engine: str
    status: str
    """Lifecycle: created | running | stopped | failed."""
    state: str
    """Live processing state of the running engine (StatusPayload.state), or 'idle'."""
    scenario: str
    seed: int | None
    model_id: str
    config_hash: str
    pace: str
    authorized: bool
    created_at: datetime
    started_at: datetime | None
    stopped_at: datetime | None
    frames_produced: int
    frames_dropped: int
    subscribers: int
    ws_path: str


class MetricSeriesOut(ApiModel):
    id: str
    t: list[float]
    v: list[float | None]


class SessionMetricsOut(ApiModel):
    session_id: str
    definitions: list[MetricDefinition]
    series: list[MetricSeriesOut]


class ScenarioOut(ApiModel):
    key: str
    title: str
    objective: str
    lesson: str
    difficulty: str
    config: dict[str, Any]


# --- recordings / artifacts ------------------------------------------------------------------


class RecordingMetadata(ApiModel):
    project_id: str = "default"
    name: str = Field(min_length=1, max_length=200)
    source_mode: Literal["recorded", "hardware", "synthetic"] = "recorded"
    format: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._+\-]+$")
    """Free-form format tag, e.g. ``csi-npz``, ``echospace-jsonl``, ``pcap``."""
    consent: bool
    """Explicit confirmation that everyone captured consented. Uploads without it are refused."""
    consent_note: str = Field(default="", max_length=2000)
    session_id: str | None = None
    sample_rate_hz: float | None = Field(default=None, gt=0)
    duration_s: float | None = Field(default=None, ge=0)
    retention_days: int | None = Field(default=None, ge=1, le=3650)
    """Overrides RAW_RETENTION_DAYS for this upload."""
    metadata: dict[str, Any] = Field(default_factory=dict)


class ArtifactOut(ApiModel):
    id: str
    key: str
    kind: str
    format: str
    content_type: str
    size_bytes: int
    sha256: str
    provenance: dict[str, Any]
    retention_until: datetime | None
    created_at: datetime


class RecordingOut(ApiModel):
    id: str
    project_id: str
    session_id: str | None
    name: str
    source_mode: str
    format: str
    sample_rate_hz: float | None
    duration_s: float | None
    consent: bool
    consent_note: str
    metadata: dict[str, Any]
    retention_until: datetime | None
    created_at: datetime
    artifact: ArtifactOut


ExperimentCreated.model_rebuild()
