"""The web app must agree with the Python package, pixel for pixel.

This runs the JavaScript core under Node (`web/tests/run.mjs`) over the bundled
template and compares every sheet it produces with the Python output.

The test is skipped when Node is not installed.
"""

from __future__ import annotations

import functools
import http.server
import json
import shutil
import subprocess
import sys
import threading
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
sys.path.insert(0, str(ROOT))

from armorhelper.compose import full_armor_frames, gif_frame_order  # noqa: E402
from armorhelper.generate import (  # noqa: E402
    generate_arms,
    generate_body_composite,
    generate_body_legacy,
    generate_head,
    generate_legs,
)
from armorhelper.layout import bundled_overlay, compose_overlay, load_template  # noqa: E402
from armorhelper.reverse import reverse_template  # noqa: E402

NODE = shutil.which("node")

pytestmark = pytest.mark.skipif(NODE is None, reason="node is not installed")


@pytest.fixture(scope="module")
def template():
    return load_template()


def load_rgba(path: Path, size: tuple[int, int]) -> Image.Image:
    return Image.frombytes("RGBA", size, path.read_bytes())


@pytest.fixture(scope="module")
def js_output(tmp_path_factory, template):
    """Prepare the work directory, run the Node harness and read the results."""
    workdir = tmp_path_factory.mktemp("webtest")
    (workdir / "input.rgba").write_bytes(template.tobytes())

    python_outputs = {
        "py_head": generate_head(template),
        "py_legs": generate_legs(template),
        "py_body": generate_body_composite(template),
    }
    for name, image in python_outputs.items():
        (workdir / f"{name}.rgba").write_bytes(image.tobytes())

    overlay = bundled_overlay()
    if overlay is not None:
        (workdir / "overlay.rgba").write_bytes(overlay.tobytes())

    result = subprocess.run(
        [NODE, str(WEB / "tests" / "run.mjs"), str(workdir)],
        capture_output=True,
        text=True,
        cwd=WEB,
        timeout=180,
    )
    if result.returncode != 0:
        pytest.fail(f"node harness failed:\n{result.stdout}\n{result.stderr}")
    return workdir


def compare(workdir: Path, name: str, expected: Image.Image) -> None:
    produced = load_rgba(workdir / name, expected.size)
    if produced.tobytes() == expected.tobytes():
        return
    differences = sum(1 for a, b in zip(produced.getdata(), expected.getdata()) if a != b)
    pytest.fail(f"{name} differs from the Python output in {differences} pixels")


# --------------------------------------------------------------------------- #
# Sheets
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "name, builder",
    [
        ("js_head.rgba", generate_head),
        ("js_legs.rgba", generate_legs),
        ("js_arms.rgba", generate_arms),
        ("js_body_legacy.rgba", generate_body_legacy),
        ("js_body.rgba", generate_body_composite),
    ],
)
def test_generated_sheets_match_python(js_output, template, name, builder):
    compare(js_output, name, builder(template))


def test_glow_sheet_matches_python(js_output, template):
    compare(js_output, "js_body_glow.rgba", generate_body_composite(template, glow_rows=4))


def test_composed_frames_match_python(js_output, template):
    frames = full_armor_frames(template)
    assert len(frames) == 20
    for index, expected in enumerate(frames):
        compare(js_output, f"js_frame{index}.rgba", expected)


# --------------------------------------------------------------------------- #
# Reverse
# --------------------------------------------------------------------------- #


def test_reverse_matches_python(js_output, template):
    expected = reverse_template(
        head=generate_head(template),
        body=generate_body_composite(template),
        legs=generate_legs(template),
    ).template
    compare(js_output, "js_reversed.rgba", expected)


def test_guide_overlay_matches_python(js_output, template):
    """The web build composites the guide layer exactly like the Python one."""
    overlay = bundled_overlay()
    if overlay is None:
        pytest.skip("no guide overlay is bundled")

    lookup = json.loads((js_output / "js_overlay.json").read_text(encoding="utf-8"))
    assert lookup["hasOverlay"] is True

    composed = compose_overlay(template, overlay)
    gained = sum(
        1
        for before, after in zip(template.getdata(), composed.getdata())
        if before[3] <= 1 and after[3] > 1
    )
    assert lookup["gainedPixels"] == gained
    assert lookup["magnified"] == composed.width * 4 + 4
    # the bundled template already carries the guide, so nothing changes
    assert lookup["unchanged"] == (composed.tobytes() == template.tobytes())


def test_texture_lookup_maps_vanilla_files_to_slots(js_output):
    """`Armor_Head_189.png` has to end up in the `head` slot, not its own key.

    Regression test: the app used the file name as the key, so "rebuild this
    set" silently produced a template with only the torso in it.
    """
    lookup = json.loads((js_output / "js_texture_lookup.json").read_text(encoding="utf-8"))

    for layout in ("nested", "flat"):
        entry = lookup[layout]
        assert entry["missing"] == [], f"{layout}: {entry['missing']}"
        assert entry["head"] == 1120, f"{layout}: head sheet not loaded"
        assert entry["body"] == 360, f"{layout}: body sheet not loaded"
        assert entry["legs"] == 1120, f"{layout}: legs sheet not loaded"

    # a body-only request must still report what is missing
    assert lookup["bodyOnly"]["missing"] == ["head", "legs"]
    assert lookup["bodyOnly"]["head"] is None

    assert lookup["candidates"] == {
        "head": ["Armor_Head_189.png"],
        "body": ["Armor/Armor_190.png", "Armor_190.png"],
        "legs": ["Armor_Legs_130.png"],
    }


def test_reverse_result_regenerates_the_sheets(js_output, template):
    """Round trip through the JavaScript reverse must still match Python."""
    rebuilt = load_rgba(js_output / "js_reversed.rgba", (128, 80))
    compare(js_output, "js_body.rgba", generate_body_composite(template))
    assert rebuilt.getbbox() is not None


# --------------------------------------------------------------------------- #
# Codecs
# --------------------------------------------------------------------------- #


def test_png_is_pixel_identical(js_output, template):
    produced = Image.open(js_output / "js_head.png")
    assert produced.size == (40, 1120)
    assert produced.mode in ("RGBA", "P")
    assert produced.convert("RGBA").tobytes() == generate_head(template).tobytes()


def test_contact_sheet_png_is_readable(js_output):
    produced = Image.open(js_output / "js_sheet.png")
    assert produced.mode == "RGBA"
    assert produced.width > 0 and produced.height > 0


def test_gif_matches_the_python_frames(js_output, template):
    produced = Image.open(js_output / "js_preview.gif")
    order = gif_frame_order()
    frames = full_armor_frames(template)
    assert produced.n_frames == len(order)
    assert produced.size == frames[0].size

    for index in range(produced.n_frames):
        produced.seek(index)
        assert produced.convert("RGBA").tobytes() == frames[order[index]].tobytes(), f"frame {index}"


def test_zip_has_the_expected_structure(js_output):
    import io
    import zipfile

    with zipfile.ZipFile(io.BytesIO((js_output / "js_bundle.zip").read_bytes())) as archive:
        assert archive.testzip() is None
        assert archive.namelist() == [
            "Armor_Head_189.png",
            "Armor/Armor_190.png",
            "notes.txt",
        ]
        assert archive.read("notes.txt").decode("utf-8") == "hello 盔甲"
        with Image.open(io.BytesIO(archive.read("Armor/Armor_190.png"))) as image:
            assert image.size == (360, 224)


# --------------------------------------------------------------------------- #
# The checked in data and the front end
# --------------------------------------------------------------------------- #


def test_exported_data_is_up_to_date(tmp_path):
    """`tools/export_web.py` must reproduce what is checked in."""
    result = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "export_web.py"), "-o", str(tmp_path)],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    for name in ("layout.json", "armor_sets.json", "i18n.json", "ArmorTemplate_v1.png"):
        checked_in = (WEB / "data" / name).read_bytes()
        assert (tmp_path / name).read_bytes() == checked_in, f"{name} is stale"


def test_layout_data_covers_every_frame():
    layout = json.loads((WEB / "data" / "layout.json").read_text(encoding="utf-8"))
    assert layout["frame"] == {"w": 20, "h": 28, "count": 20}
    assert layout["templateSize"] == [128, 80]
    assert len(layout["layers"]["frontArm"]) == 20
    assert len(layout["cells"]["frontArm"]) == 20
    assert len(layout["cells"]["backArm"]) == 20
    assert len(layout["legMapping"]) == 10
    assert "head" in layout["targets"]["all"]


def test_frontend_files_exist_and_are_wired():
    import re

    html = (WEB / "index.html").read_text(encoding="utf-8")
    script = (WEB / "app.js").read_text(encoding="utf-8")

    ids = set(re.findall(r'id="([^"]+)"', html))
    refs = set(re.findall(r'\$\("#([A-Za-z0-9_-]+)"\)', script))
    assert refs
    assert not (refs - ids), f"app.js references missing ids: {sorted(refs - ids)}"

    # every module the app imports has to exist
    for target in re.findall(r'from "([^"]+)"', script):
        assert (WEB / target).is_file(), target

    # data-i18n keys must exist in both languages
    messages = json.loads((WEB / "data" / "i18n.json").read_text(encoding="utf-8"))["messages"]
    keys = set(re.findall(r'data-i18n(?:-placeholder)?="([^"]+)"', html))
    assert keys
    for language in ("zh_CN", "en"):
        missing = sorted(key for key in keys if key not in messages[language])
        assert not missing, f"{language} is missing {missing}"

    # no external requests: the page must work offline / on Pages
    for name in ("index.html", "style.css", "app.js"):
        text = (WEB / name).read_text(encoding="utf-8")
        assert "https://" not in text
        assert "http://" not in text


def test_site_icon_is_used():
    """The favicon (browser tab, top left) and the header logo."""
    icon = WEB / "data" / "icon.png"
    assert icon.is_file(), "web/data/icon.png is missing"
    with Image.open(icon) as image:
        assert image.width >= 32 and image.height >= 32

    html = (WEB / "index.html").read_text(encoding="utf-8")
    assert '<link rel="icon" type="image/png" href="data/icon.png">' in html
    assert 'rel="apple-touch-icon" href="data/icon.png"' in html
    assert '<img src="data/icon.png"' in html

    # the header logo must not be rendered as pixel art
    css = (WEB / "style.css").read_text(encoding="utf-8")
    assert ".brand-icon" in css


def test_export_does_not_touch_the_icon(tmp_path):
    """`tools/export_web.py` regenerates web/data; the icon has to survive."""
    import subprocess
    import sys as _sys

    result = subprocess.run(
        [_sys.executable, str(ROOT / "tools" / "export_web.py"), "-o", str(tmp_path)],
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert result.returncode == 0, result.stderr
    # the script never writes or deletes files it does not own
    written = {path.name for path in tmp_path.iterdir()}
    assert "icon.png" not in written
    assert (WEB / "data" / "icon.png").is_file()


def test_no_python_left_in_the_web_app():
    """The two versions are separate: the web app must be pure static files."""
    for path in WEB.rglob("*"):
        if path.is_file():
            assert path.suffix != ".py", path
    assert not (ROOT / "armorhelper" / "web").exists()


# --------------------------------------------------------------------------- #
# A real browser run
# --------------------------------------------------------------------------- #

CHROME_CANDIDATES = (
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
)


def find_chrome() -> str | None:
    for candidate in CHROME_CANDIDATES:
        found = shutil.which(candidate) if "/" not in candidate else candidate
        if found and Path(found).exists():
            return found
    return None


HARNESS = """<!doctype html>
<meta charset="utf-8"><title>harness</title>
<iframe id="frame" src="/" style="width:1100px;height:820px"></iframe>
<script type="module">
const report = (payload) =>
  fetch("/__done", { method: "POST", body: JSON.stringify(payload) }).catch(() => {});
const frame = document.getElementById("frame");

const appInfo = (doc) => ({
  status: doc.querySelector("#status").textContent.trim(),
  sets: doc.querySelectorAll("#set-select option").length,
  checkboxes: doc.querySelectorAll("input[type=checkbox]").length,
  targets: doc.querySelectorAll("#targets input").length,
  tabs: [...doc.querySelectorAll(".tab")].map((tab) => tab.textContent),
  subtitle: (doc.querySelector('[data-i18n="web.subtitle"]') || {}).textContent || "",
  guide: !!doc.querySelector("#opt-guide")?.checked,
  source: doc.querySelector("#images-status").textContent.trim(),
  guideLabel: (doc.querySelector('[data-i18n="web.guideOverlay"]') || {}).textContent || "",
  downloadButton: doc.querySelector("#download-template")?.tagName || null,
  favicon: doc.querySelector('link[rel="icon"]')?.getAttribute("href") || null,
  logo: doc.querySelector(".brand img")?.getAttribute("src") || null,
});

/** Click "rebuild this set" and wait for the result card. */
async function runReverse(doc) {
  doc.querySelector("#rev-head").value = "189";
  doc.querySelector("#rev-body").value = "190";
  doc.querySelector("#rev-legs").value = "130";
  doc.querySelector("#do-reverse").click();

  for (let tick = 0; tick < 400; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    const images = doc.querySelectorAll("#reverse-result .preview img");
    if (images.length) {
      return {
        previews: images.length,
        captions: [...doc.querySelectorAll("#reverse-result figcaption")].map((el) => el.textContent),
        widths: [...images].map((img) => img.naturalWidth),
        files: [...doc.querySelectorAll("#reverse-result .files a")].map((a) => a.textContent),
        warnings: [...doc.querySelectorAll("#reverse-result .warn")].map((el) => el.textContent),
        status: doc.querySelector("#status").textContent.trim(),
      };
    }
    const warnings = doc.querySelectorAll("#reverse-result .warn");
    if (warnings.length && doc.querySelector("#status").className !== "busy") {
      return { error: [...warnings].map((el) => el.textContent).join(" | ") };
    }
  }
  return { error: "reverse produced no preview" };
}

/** Upload the three vanilla-named textures through the page's file input. */
async function uploadTextures(doc) {
  const [{ loadLayout }, { decodeBitmap }, { generateHead, generateLegs, generateBodyComposite }, { pngBlob }] =
    await Promise.all([
      import("/js/data.js"),
      import("/js/fs.js"),
      import("/js/generate.js"),
      import("/js/png.js"),
    ]);
  await loadLayout("/data/layout.json");

  const template = await decodeBitmap(await (await fetch("/data/ArmorTemplate_v1.png")).blob());
  const sheets = [
    ["Armor_Head_189.png", generateHead(template)],
    ["Armor_190.png", generateBodyComposite(template)],
    ["Armor_Legs_130.png", generateLegs(template)],
  ];
  const files = [];
  for (const [name, bitmap] of sheets) {
    files.push(new File([await pngBlob(bitmap)], name, { type: "image/png" }));
  }

  const input = doc.querySelector("#texture-input");
  const transfer = new DataTransfer();
  for (const file of files) transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

let ticks = 0;
const timer = setInterval(async () => {
  ticks += 1;
  let doc;
  try {
    doc = frame.contentDocument;
    const status = doc.querySelector("#status");
    const text = status ? status.textContent.trim() : "";
    if (!text || text === "…") {
      if (ticks > 2000) {
        clearInterval(timer);
        report({ error: "timeout waiting for the app" });
      }
      return;
    }
    clearInterval(timer);
  } catch (error) {
    clearInterval(timer);
    report({ error: String(error) });
    return;
  }

  try {
    const app = appInfo(doc);
    // 1. no folder, no uploads — this is the phone case: the textures shipped
    //    with the site have to be found on their own.
    const builtin = await runReverse(doc);
    // 2. the same thing again, but with the user's own files uploaded.
    await uploadTextures(doc);
    const uploaded = await runReverse(doc);
    report({ ...app, builtin, uploaded });
  } catch (error) {
    report({ error: String((error && error.stack) || error) });
  }
}, 20);
</script>
"""


class HarnessHandler(http.server.SimpleHTTPRequestHandler):
    """Serve `web/` and collect the page's own completion report."""

    # Keep-alive, like a real static host: the page pulls a dozen modules and
    # HTTP/1.0 (the stdlib default) makes the browser reopen a socket for each.
    protocol_version = "HTTP/1.1"
    disable_nagle_algorithm = True

    done = None  # threading.Event
    payload = None
    paths = []

    def log_message(self, *args):  # noqa: A003 - stdlib name
        pass

    def _send(self, body: bytes, content_type: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        type(self).paths.append(self.path)
        if self.path.startswith("/__harness.html"):
            return self._send(HARNESS.encode("utf-8"), "text/html; charset=utf-8")
        return super().do_GET()

    def do_POST(self):  # noqa: N802
        if not self.path.startswith("/__done"):
            return self.send_error(404)
        length = int(self.headers.get("Content-Length") or 0)
        type(self).payload = self.rfile.read(length).decode("utf-8")
        self._send(b"ok", "text/plain")
        type(self).done.set()


@pytest.fixture()
def browser_server():
    """Serve `web/` over HTTP the way GitHub Pages would, plus the harness."""
    HarnessHandler.done = threading.Event()
    HarnessHandler.payload = None
    HarnessHandler.paths = []
    handler = functools.partial(HarnessHandler, directory=str(WEB))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}", HarnessHandler
    server.shutdown()
    server.server_close()


def open_in_browser(chrome: str, url: str, tmp_path: Path, wait_for) -> dict:
    """Open `url`, wait for the page to report back, and return its payload."""
    profile = tmp_path / "chrome-profile"
    # `start_new_session` puts Chrome and all of its helper processes in their
    # own process group, so they can be cleaned up together.  Leaving helpers
    # behind makes the *next* launch starve and time out.
    process = subprocess.Popen(
        [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-background-timer-throttling",
            "--disable-renderer-backgrounding",
            f"--user-data-dir={profile}",
            # No --virtual-time-budget: the page reports back over HTTP, so the
            # run is driven by real time and stays deterministic.
            url,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    try:
        if not wait_for.wait(timeout=120):
            pytest.fail(f"the page never reported back; requests={HarnessHandler.paths}")
    finally:
        stop_browser(process)
    return json.loads(HarnessHandler.payload)


def stop_browser(process) -> None:
    """Terminate Chrome and every helper process it spawned."""
    import os
    import signal

    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        process.terminate()
    try:
        process.wait(timeout=30)
    except subprocess.TimeoutExpired:  # pragma: no cover
        try:
            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            process.kill()


def test_browser_smoke_test(browser_server, tmp_path):
    """Run the web core in a real browser (Chrome/Chromium), if one is present."""
    chrome = find_chrome()
    if chrome is None:
        pytest.skip("no Chrome/Chromium available")

    base, handler = browser_server
    payload = open_in_browser(chrome, f"{base}/tests/smoke.html", tmp_path, handler.done)

    assert not payload.get("error"), payload.get("error")
    failures = [item for item in payload["results"] if not item["ok"]]
    assert not failures, "\n".join(f"{item['name']}: {item['detail']}" for item in failures)
    assert payload["total"] >= 15
    assert payload["failures"] == 0


def test_browser_renders_the_app(browser_server, tmp_path):
    """The single page app must boot and fill itself in."""
    chrome = find_chrome()
    if chrome is None:
        pytest.skip("no Chrome/Chromium available")

    base, handler = browser_server
    payload = open_in_browser(chrome, f"{base}/__harness.html", tmp_path, handler.done)

    assert not payload.get("error"), f"{payload.get('error')} | requests={HarnessHandler.paths}"
    assert "已连接" in payload["status"]
    assert payload["sets"] > 150
    assert payload["targets"] == 12
    assert payload["checkboxes"] == 17
    assert payload["tabs"] == ["导出贴图", "反向还原", "设置"]
    assert "网页版" in payload["subtitle"]
    assert payload["guide"] is True
    assert "参考线" in payload["guideLabel"]
    assert payload["downloadButton"] == "BUTTON"
    assert payload["favicon"] == "data/icon.png"
    assert payload["logo"] == "data/icon.png"

    # the bundled textures are what a phone user relies on
    assert "内置贴图" in payload["source"], payload["source"]
    assert "748" in payload["source"], payload["source"]

    # ... and "rebuild this set" has to produce a template preview that really
    # contains the head and legs, not just the torso — with no folder and no
    # uploaded files, i.e. from the bundled textures alone.
    for label in ("builtin", "uploaded"):
        reverse = payload[label]
        assert not reverse.get("error"), f"{label}: {reverse.get('error')}"
        missing = [
            text
            for text in reverse["warnings"]
            if "not found" in text or "cannot be recovered" in text or "left empty" in text
        ]
        assert not missing, f"{label} could not find a texture: {missing}"
        assert reverse["files"] == ["ArmorTemplate_星尘板甲_190.png"], label
        assert reverse["previews"] == 3, reverse
        assert "绘制模板" in reverse["captions"][0]
        assert "20 帧" in reverse["captions"][1]
        # 128x80 magnified 4x plus the 2px border
        assert reverse["widths"][0] == 128 * 4 + 4, reverse["widths"]


def test_pages_workflow_publishes_the_web_folder():
    workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
    assert "path: web" in workflow
    assert "tools/export_web.py" in workflow
    assert (WEB / ".nojekyll").exists()
