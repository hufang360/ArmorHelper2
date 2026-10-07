"""ArmorHelper 2 — a Python rewrite of Mirsario's ArmorHelper.

The original tool (2018, .NET Framework / WinForms) converted a small, easy to
draw "armor template" (128x80 px) into Terraria's armor sprite sheets.

Terraria 1.4.4 rewrote how the player body is drawn ("composite" player
rendering).  The body + arms are no longer two separate 20 frame sheets, they
are a single 9 x 4 (9 x 8 when the armor glows) grid of 40x56 frames.  This
package keeps the original template format and emits the new sheets.

See ``README.md`` for a description of the new texture layout.
"""

from __future__ import annotations

__all__ = [
    "__version__",
    "ArmorTemplateError",
    "load_template",
    "generate_sheets",
    "TEMPLATE_SIZE",
]

__version__ = "2.0.0"

TEMPLATE_SIZE = (128, 80)


class ArmorTemplateError(ValueError):
    """Raised when an input image is not a valid ArmorHelper template."""


from .generate import generate as generate_sheets  # noqa: E402
from .layout import load_template  # noqa: E402
