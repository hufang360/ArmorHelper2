"""The web front end: a local HTTP server plus a small single page app.

The browser never does any image work; it talks to the same ``armorhelper``
package the desktop version uses, so both produce byte identical output.
"""

from __future__ import annotations

from .api import Api, ApiError
from .server import Handler, Server, make_server, serve

__all__ = ["Api", "ApiError", "Handler", "Server", "make_server", "serve", "STATIC_DIR"]

from .server import STATIC_DIR  # noqa: E402  (kept last: it touches the filesystem)
