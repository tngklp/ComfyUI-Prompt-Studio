"""Static-file serving with explicit cache headers.

Why this module exists
----------------------
``aiohttp``'s ``add_static`` sends ``Last-Modified`` and an ``ETag`` but **no**
``Cache-Control``. With no explicit freshness information a browser is free to
apply *heuristic* freshness, and in practice it treats a stylesheet or an ES module
as fresh for a fraction of its age. That is fine for a versioned bundle and wrong
for a development host: a rebuilt ``main.js`` or a newly added stylesheet is
served from the browser's cache, so a change appears to do nothing until the user
hard-refreshes.

The fix is to say what we mean instead of leaving it to the browser:

* every response carries ``Cache-Control: no-cache``, which does **not** mean "do
  not store" - it means "store it, but revalidate with us before using it";
* ``ETag`` and ``Last-Modified`` are sent, so a revalidation is a cheap ``304``;
* ``must-revalidate`` forbids serving a stale copy when the revalidation fails.

The practical effect is that a changed file is picked up on the next ordinary
reload, with no hard refresh, and an unchanged file still costs one conditional
request rather than a full body.

This is deliberately a development-server policy. A production build would want
content-hashed filenames with a long ``max-age`` instead.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Iterable

from aiohttp import web

# `no-cache` rather than `no-store`: the asset is cached but must be revalidated,
# so the common case (nothing changed) is a 304 with an empty body.
REVALIDATE_HEADERS = {
    "Cache-Control": "no-cache, must-revalidate",
}

# Extensions whose bytes are read by the browser as code or styling. These are the
# ones a stale cache actually breaks, so they are listed explicitly to keep the
# intent legible rather than relying on "everything is revalidated".
CODE_EXTENSIONS = frozenset({".js", ".mjs", ".css", ".json", ".map", ".html", ".svg"})


def _etag_for(path: Path, stat: Any) -> str:
    """A cheap, stable validator.

    Size and modification time mean the tag changes whenever the file does, and
    computing it costs one ``stat`` call rather than hashing the body. The path is
    mixed in so two files of identical size and mtime cannot collide.
    """
    seed = f"{path}:{stat.st_size}:{stat.st_mtime_ns}".encode("utf-8")
    return '"' + hashlib.sha256(seed).hexdigest()[:32] + '"'


def _revalidate_headers(path: Path, stat: Any) -> dict[str, str]:
    headers = dict(REVALIDATE_HEADERS)
    headers["ETag"] = _etag_for(path, stat)
    return headers


class RevalidatingStaticResource:
    """Serve one directory with explicit cache revalidation.

    Registered the same way as ``web.StaticResource`` and intended as a drop-in
    replacement, but it always states its cache policy.
    """

    def __init__(self, prefix: str, directory: Path) -> None:
        self._prefix = prefix
        self._directory = Path(directory)

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"<RevalidatingStaticResource {self._prefix} -> {self._directory}>"

    def _resolve(self, request: web.Request) -> Path | None:
        """Map a request path to a file inside the served directory, or None.

        A path that escapes the served directory resolves to None rather than
        raising, so traversal attempts are indistinguishable from a missing file.
        """
        relative = request.match_info.get("filename", "")
        if not relative:
            return None
        candidate = (self._directory / relative).resolve()
        try:
            candidate.relative_to(self._directory.resolve())
        except ValueError:
            return None
        if not candidate.is_file():
            return None
        return candidate

    async def handle(self, request: web.Request) -> web.StreamResponse:
        path = self._resolve(request)
        if path is None:
            raise web.HTTPNotFound()
        stat = path.stat()
        headers = _revalidate_headers(path, stat)
        etag = headers["ETag"]
        # A conditional request that still matches costs one 304 and no body.
        if request.headers.get("If-None-Match") == etag:
            raise web.HTTPNotModified(headers=headers)
        return web.FileResponse(path, headers=headers)


def register_static(app: web.Application, prefix: str, directory: Path) -> RevalidatingStaticResource:
    """Register a directory and return the resource, for tests to introspect."""
    if not prefix.endswith("/"):
        prefix += "/"
    resource = RevalidatingStaticResource(prefix, directory)
    app.router.add_route("GET", prefix + "{filename:.*}", resource.handle)
    app.router.add_route("HEAD", prefix + "{filename:.*}", resource.handle)
    return resource


def cache_control_header(response: Any) -> str | None:
    """Read back the cache policy a response advertises. Used by tests."""
    return response.headers.get("Cache-Control")
