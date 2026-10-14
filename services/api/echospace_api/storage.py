"""Object store for payloads that do not belong in database rows.

Two backends with the same interface: a local directory (default, ``OBJECT_STORE=local``) and an
S3-compatible bucket (``OBJECT_STORE=s3``; AWS S3 or MinIO via ``S3_ENDPOINT``). Keys are
slash-separated relative paths such as ``projects/default/experiments/exp_1/payload.json``.
"""

from __future__ import annotations

import hashlib
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Protocol

from .settings import Settings

_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-/]*$")
CHUNK = 1 << 20


class ObjectNotFoundError(KeyError):
    pass


@dataclass(frozen=True)
class StoredObject:
    key: str
    size_bytes: int
    sha256: str


def check_key(key: str) -> str:
    if not _KEY.match(key) or ".." in key.split("/") or "//" in key:
        raise ValueError(f"invalid object key {key!r}")
    return key


class ObjectStore(Protocol):
    kind: str

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> StoredObject: ...
    def put_stream(self, key: str, stream: BinaryIO, content_type: str, max_bytes: int) -> StoredObject: ...
    def get_bytes(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def exists(self, key: str) -> bool: ...
    def ping(self) -> None: ...


class ObjectTooLargeError(ValueError):
    pass


def _copy_hashing(stream: BinaryIO, out: BinaryIO, max_bytes: int) -> tuple[int, str]:
    h = hashlib.sha256()
    size = 0
    while chunk := stream.read(CHUNK):
        size += len(chunk)
        if size > max_bytes:
            raise ObjectTooLargeError(f"object exceeds {max_bytes} bytes")
        h.update(chunk)
        out.write(chunk)
    return size, h.hexdigest()


class LocalObjectStore:
    kind = "local"

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / check_key(key)).resolve()
        if self.root not in p.parents:
            raise ValueError(f"invalid object key {key!r}")
        return p

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> StoredObject:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".upload-")
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, p)
        return StoredObject(key, len(data), hashlib.sha256(data).hexdigest())

    def put_stream(self, key: str, stream: BinaryIO, content_type: str, max_bytes: int) -> StoredObject:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=p.parent, prefix=".upload-")
        try:
            with os.fdopen(fd, "wb") as f:
                size, digest = _copy_hashing(stream, f, max_bytes)
            os.replace(tmp, p)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        return StoredObject(key, size, digest)

    def get_bytes(self, key: str) -> bytes:
        p = self._path(key)
        if not p.is_file():
            raise ObjectNotFoundError(key)
        return p.read_bytes()

    def delete(self, key: str) -> None:
        p = self._path(key)
        p.unlink(missing_ok=True)
        # Remove now-empty parent directories up to the root.
        for parent in p.parents:
            if parent == self.root:
                break
            try:
                parent.rmdir()
            except OSError:
                break

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def ping(self) -> None:
        if not os.access(self.root, os.W_OK):
            raise OSError(f"{self.root} is not writable")


class S3ObjectStore:
    kind = "s3"

    def __init__(self, bucket: str, endpoint: str | None, region: str) -> None:
        import boto3

        self.bucket = bucket
        self.client = boto3.client("s3", endpoint_url=endpoint, region_name=region)

    def put_bytes(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> StoredObject:
        self.client.put_object(Bucket=self.bucket, Key=check_key(key), Body=data, ContentType=content_type)
        return StoredObject(key, len(data), hashlib.sha256(data).hexdigest())

    def put_stream(self, key: str, stream: BinaryIO, content_type: str, max_bytes: int) -> StoredObject:
        # Spool to a temporary file first so size and hash are known before the upload.
        with tempfile.TemporaryFile() as tmp:
            size, digest = _copy_hashing(stream, tmp, max_bytes)
            tmp.seek(0)
            self.client.upload_fileobj(tmp, self.bucket, check_key(key), ExtraArgs={"ContentType": content_type})
        return StoredObject(key, size, digest)

    def get_bytes(self, key: str) -> bytes:
        try:
            obj = self.client.get_object(Bucket=self.bucket, Key=check_key(key))
        except self.client.exceptions.NoSuchKey as e:
            raise ObjectNotFoundError(key) from e
        data: bytes = obj["Body"].read()
        return data

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=check_key(key))

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self.client.head_object(Bucket=self.bucket, Key=check_key(key))
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return False
            raise
        return True

    def ping(self) -> None:
        self.client.head_bucket(Bucket=self.bucket)


def make_object_store(settings: Settings) -> ObjectStore:
    if settings.object_store == "s3":
        return S3ObjectStore(settings.s3_bucket, settings.s3_endpoint, settings.s3_region)
    return LocalObjectStore(settings.object_store_dir)
