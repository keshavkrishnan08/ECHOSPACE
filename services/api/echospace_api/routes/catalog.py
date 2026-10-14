"""Model registry and dataset manifests (read from the repository files)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from ..catalog import load_manifests, load_registry
from ..deps import Ctx

router = APIRouter()


@router.get("/api/models")
def list_models(ctx: Ctx) -> dict[str, Any]:
    """Model cards from models/registry.json (zod ``ModelCard`` shape)."""
    return {"items": [c.model_dump(by_alias=True, mode="json") for c in load_registry(ctx.settings.models_dir)]}


@router.get("/api/models/{model_id}")
def get_model(model_id: str, ctx: Ctx) -> dict[str, Any]:
    for c in load_registry(ctx.settings.models_dir):
        if c.id == model_id:
            return c.model_dump(by_alias=True, mode="json")
    raise HTTPException(status_code=404, detail=f"model {model_id!r} not in registry")


@router.get("/api/datasets")
def list_datasets(ctx: Ctx) -> dict[str, Any]:
    """Dataset manifests from datasets/manifests/*.json (zod ``DatasetManifest`` shape)."""
    return {"items": [m.model_dump(by_alias=True, mode="json") for m in load_manifests(ctx.settings.datasets_dir)]}
