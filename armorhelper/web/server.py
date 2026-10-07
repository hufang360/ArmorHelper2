"""A tiny HTTP server for the web front end (standard library only).

The server binds to ``127.0.0.1`` by default; it is a local tool for a local
folder, not something to expose.  All routes are JSON except the static assets
and the generated images.
"""

from __future__ import annotations

import json
import logging
import mimetypes
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .api import Api, ApiError

__all__ = ["serve", "make_server", "STATIC_DIR"]

log = logging.getLogger("armorhelper")

STATIC_DIR = Path(__file__).resolve().parent / "static"

#: Refuse request bodies larger than this (a 128x80 PNG is a few kB).
MAX_BODY = 32 * 1024 * 1024


class Handler(BaseHTTPRequestHandler):
    server_version = "ArmorHelperWeb"
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------- helpers --
    @property
    def api(self) -> Api:
        return self.server.api  # type: ignore[attr-defined]

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003 - stdlib name
        log.debug("%s - %s", self.address_string(), fmt % args)

    def _send(self, status: int, body: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, data, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8")

    def _error(self, message: str, status: int = 400) -> None:
        self._json({"error": message}, status)

    def _read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ApiError("bad Content-Length") from None
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise ApiError("payload too large")
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise ApiError("body must be JSON") from None
        if not isinstance(data, dict):
            raise ApiError("body must be a JSON object")
        return data

    # --------------------------------------------------------------- verbs --
    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        self._handle("GET")

    def do_HEAD(self) -> None:  # noqa: N802
        self._handle("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._handle("POST")

    def _handle(self, method: str) -> None:
        parsed = urlparse(self.path)
        route = unquote(parsed.path)
        query = parse_qs(parsed.query)
        try:
            self._route(method, route, query)
        except ApiError as error:
            self._error(str(error))
        except BrokenPipeError:  # pragma: no cover - browser navigated away
            pass
        except Exception as error:  # noqa: BLE001 - never kill the server
            log.exception("unhandled error for %s %s", method, route)
            self._error(f"internal error: {error}", 500)

    def _route(self, method: str, route: str, query: dict) -> None:
        api = self.api

        # --- static assets -------------------------------------------------
        if route in ("/", "/index.html"):
            return self._serve_static("index.html")
        if route.startswith("/static/"):
            return self._serve_static(route[len("/static/") :])
        if route == "/favicon.ico":
            return self._serve_static("favicon.png", not_found_ok=True)

        # --- settings ------------------------------------------------------
        if route == "/api/state":
            if method == "POST":
                return self._json(api.update_state(self._read_json()))
            return self._json(api.get_state())
        if route == "/api/i18n":
            return self._json(api.i18n())
        if route == "/api/targets":
            return self._json(api.targets())
        if route == "/api/template":
            return self._send(200, api.template_png(), "image/png")
        if route == "/api/detect-images" and method == "POST":
            return self._json(api.detect_images_dir())

        # --- vanilla -------------------------------------------------------
        if route == "/api/sets":
            return self._json(api.sets((query.get("q") or [""])[0]))
        if route == "/api/browse":
            return self._json(api.browse((query.get("path") or [""])[0]))

        # --- work ----------------------------------------------------------
        if route == "/api/generate" and method == "POST":
            return self._json(api.generate(self._read_json()))
        if route == "/api/reverse" and method == "POST":
            return self._json(api.reverse(self._read_json()))
        if route == "/api/reverse-all" and method == "POST":
            return self._json(api.reverse_all(self._read_json()))

        # --- generated files -----------------------------------------------
        if route.startswith("/api/job/"):
            parts = route[len("/api/job/") :].split("/")
            if len(parts) >= 2:
                job_id, name = parts[0], "/".join(parts[1:])
                if name == "all.zip":
                    return self._send(200, api.job_zip(job_id), "application/zip")
                path = api.job_file(job_id, name)
                content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                return self._send(200, path.read_bytes(), content_type)

        self._error(f"no route for {method} {route}", 404)

    def _serve_static(self, name: str, *, not_found_ok: bool = False) -> None:
        if "/" in name or "\\" in name or name in ("", ".", ".."):
            return self._error("bad asset name", 404)
        path = STATIC_DIR / name
        if not path.is_file():
            if not_found_ok:
                return self._send(204, b"", "image/png")
            return self._error(f"missing asset {name}", 404)
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type.endswith(("javascript", "json")):
            content_type += "; charset=utf-8"
        return self._send(200, path.read_bytes(), content_type)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, api: Api) -> None:
        super().__init__(address, handler)
        self.api = api


def make_server(host: str = "127.0.0.1", port: int = 8765, *, api: Api | None = None) -> Server:
    """Create (but do not start) the HTTP server."""
    return Server((host, port), Handler, api or Api())


def serve(
    host: str = "127.0.0.1",
    port: int = 8765,
    *,
    open_browser: bool = False,
    api: Api | None = None,
    block: bool = True,
) -> Server:
    """Run the web UI.  With ``block=False`` it returns the server instead."""
    server = make_server(host, port, api=api)
    actual_host, actual_port = server.server_address[:2]
    url = f"http://{actual_host}:{actual_port}/"
    log.info("ArmorHelper web UI: %s", url)
    log.info("press Ctrl+C to stop")

    if open_browser:
        threading.Timer(0.4, lambda: webbrowser.open(url)).start()

    if not block:
        return server

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("stopping")
    finally:
        server.server_close()
    return server
