"""Model registry, dataset manifests and scenario presets.

The canonical sources are files in the repository: ``models/registry.json`` and
``datasets/manifests/*.json``. They are validated on read and mirrored into the ``models`` /
``model_versions`` and ``datasets`` / ``dataset_manifests`` tables at startup so that sessions and
experiments can be joined against them.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy.orm import Session

from echospace_sim import list_presets, load_preset

from .db import Dataset, DatasetManifestRow, ModelRow, ModelVersion

log = logging.getLogger(__name__)


class _Camel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class ModelEvaluation(_Camel):
    dataset: str
    split: str
    metric: str
    value: float
    note: str = ""


class ModelCard(_Camel):
    """Mirror of zod ``ModelCard`` (packages/schemas/src/model.ts)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid", protected_namespaces=())

    id: str
    name: str
    family: Literal["classical", "shallow-learned", "tcn", "transformer", "fusion", "state-estimator"]
    version: str
    status: Literal["available", "experimental", "unavailable"]
    description: str
    input_schema: str
    output_schema: str
    preprocessing_version: str
    inference_device: str
    confidence_semantics: str
    supported_tasks: list[
        Literal["occupancy-3d", "occupancy-floor", "point-cloud", "localization", "tracking", "skeleton"]
    ]
    provides_joints: bool
    training_dataset: str | None
    known_limitations: list[str]
    requirements: list[str] = Field(default_factory=list)
    evaluation: list[ModelEvaluation] = Field(default_factory=list)
    references: list[str] = Field(default_factory=list)


class DatasetValidation(_Camel):
    status: Literal["unvalidated", "valid", "invalid"]
    checked_at: str | None
    issues: list[str] = Field(default_factory=list)


class DatasetManifest(_Camel):
    """Mirror of zod ``DatasetManifest`` (packages/schemas/src/dataset.ts)."""

    id: str
    name: str
    version: str
    source: Literal["synthetic", "recorded-csi", "recorded-iq", "public"]
    license: str
    usage_restrictions: str
    capture_methodology: str
    duration_s: float | None
    sample_format: str
    channel_count: int | None
    sample_rate_hz: float | None
    scene_metadata: dict[str, Any] = Field(default_factory=dict)
    annotations: list[str] = Field(default_factory=list)
    splits: dict[str, list[str]] = Field(default_factory=dict)
    validation: DatasetValidation
    consent: Literal["not-applicable", "obtained", "unknown"] = "not-applicable"
    checksum: str | None = None


def load_registry(models_dir: Path) -> list[ModelCard]:
    path = models_dir / "registry.json"
    if not path.is_file():
        return []
    return [ModelCard.model_validate(c) for c in json.loads(path.read_text(encoding="utf-8"))]


def load_manifests(datasets_dir: Path) -> list[DatasetManifest]:
    out = []
    for p in sorted(datasets_dir.glob("*.json")):
        try:
            out.append(DatasetManifest.model_validate_json(p.read_text(encoding="utf-8")))
        except ValueError as e:
            log.warning("skipping invalid dataset manifest", extra={"file": p.name, "error": str(e)[:500]})
    return out


def scenarios() -> list[dict[str, Any]]:
    return [{**meta, "config": load_preset(meta["key"]).to_json_dict()} for meta in list_presets()]


def _weights_sha256(models_dir: Path, model_id: str) -> str | None:
    p = models_dir / "baselines" / model_id.replace("-", "_") / "weights.json"
    return hashlib.sha256(p.read_bytes()).hexdigest() if p.is_file() else None


def sync_catalog(db: Session, models_dir: Path, datasets_dir: Path) -> None:
    """Upserts registry cards and dataset manifests into the database."""
    for card in load_registry(models_dir):
        row = db.get(ModelRow, card.id) or ModelRow(id=card.id)
        row.name, row.family, row.status = card.name, card.family, card.status
        db.add(row)
        db.flush()
        mv = db.query(ModelVersion).filter_by(model_id=card.id, version=card.version).one_or_none()
        if mv is None:
            mv = ModelVersion(model_id=card.id, version=card.version)
            db.add(mv)
        mv.preprocessing_version = card.preprocessing_version
        mv.card = card.model_dump(by_alias=True, mode="json")
        mv.weights_sha256 = _weights_sha256(models_dir, card.id)
    for m in load_manifests(datasets_dir):
        ds = db.get(Dataset, m.id) or Dataset(id=m.id)
        ds.name, ds.source = m.name, m.source
        db.add(ds)
        db.flush()
        row = db.query(DatasetManifestRow).filter_by(dataset_id=m.id, version=m.version).one_or_none()
        if row is None:
            row = DatasetManifestRow(dataset_id=m.id, version=m.version)
            db.add(row)
        row.checksum = m.checksum
        row.manifest = m.model_dump(by_alias=True, mode="json")
    db.commit()
