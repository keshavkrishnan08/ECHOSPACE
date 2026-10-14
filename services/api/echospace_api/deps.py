"""Request dependencies: database session, object store, current user and project access.

Authentication is "local" mode: every request acts as the single local user seeded at startup.
Authorization goes through :func:`current_user` and :func:`require_member`, so replacing local
mode with a real identity provider only means changing :func:`current_user`.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from typing import TYPE_CHECKING, Annotated, Any

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session
from starlette.requests import HTTPConnection

from .db import AuditEvent, Database, Project, ProjectMember, User
from .observability import request_id_var
from .settings import Settings
from .storage import ObjectStore

if TYPE_CHECKING:
    from .runtime import SessionManager

LOCAL_USER_ID = "user_local"
DEFAULT_PROJECT_ID = "default"


@dataclass
class AppContext:
    settings: Settings
    db: Database
    store: ObjectStore
    sessions: SessionManager
    started_monotonic: float


def get_ctx(conn: HTTPConnection) -> AppContext:
    ctx: AppContext = conn.app.state.ctx
    return ctx


def get_db(ctx: Annotated[AppContext, Depends(get_ctx)]) -> Iterator[Session]:
    with ctx.db.session() as s:
        yield s


Ctx = Annotated[AppContext, Depends(get_ctx)]
Db = Annotated[Session, Depends(get_db)]


def current_user(db: Db) -> User:
    user = db.get(User, LOCAL_USER_ID)
    if user is None:
        raise HTTPException(status_code=401, detail="local user is not provisioned")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def require_member(db: Session, user: User, project_id: str) -> tuple[Project, ProjectMember]:
    """The project and the user's membership, or 404 (unknown project) / 403 (not a member)."""
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail=f"project {project_id!r} not found")
    member = db.get(ProjectMember, (project_id, user.id))
    if member is None:
        raise HTTPException(status_code=403, detail=f"user is not a member of project {project_id!r}")
    return project, member


def audit(
    db: Session,
    user: User | None,
    project_id: str | None,
    action: str,
    target_type: str,
    target_id: str,
    **details: Any,
) -> None:
    db.add(
        AuditEvent(
            user_id=user.id if user else None,
            project_id=project_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            request_id=request_id_var.get(),
            details=details,
        )
    )


def seed_defaults(db: Session, username: str) -> None:
    """Creates the local user, the default project and the membership if they are missing."""
    if db.get(User, LOCAL_USER_ID) is None:
        db.add(User(id=LOCAL_USER_ID, username=username, display_name="Local user"))
    if db.get(Project, DEFAULT_PROJECT_ID) is None:
        db.add(Project(id=DEFAULT_PROJECT_ID, name="default", description="Default project"))
    db.flush()
    exists = db.scalar(
        select(ProjectMember).where(
            ProjectMember.project_id == DEFAULT_PROJECT_ID, ProjectMember.user_id == LOCAL_USER_ID
        )
    )
    if exists is None:
        db.add(ProjectMember(project_id=DEFAULT_PROJECT_ID, user_id=LOCAL_USER_ID, role="owner"))
    db.commit()
