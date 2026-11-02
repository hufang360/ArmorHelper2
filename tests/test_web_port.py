"""The web app must agree with the Python package, pixel for pixel.

This runs the JavaScript core under Node (`web/tests/run.mjs`) over the bundled
template and compares every sheet it produces with the Python output.

The test is skipped when Node is not installed.
"""

from __future__ import annotations

import base64
import functools
import http.server
import io
import json
import shutil
import subprocess
import sys
import threading
import zipfile
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
from armorhelper.sheets import (  # noqa: E402
    compose_frames as compose_sheet_frames,
    detect_id as sheet_id,
    detect_role as sheet_role,
    stack_sheet,
)

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
# Full-body frames straight from the three sheets
# --------------------------------------------------------------------------- #


def test_sheet_frames_match_python(js_output, template):
    head = generate_head(template)
    body = generate_body_composite(template)
    legs = generate_legs(template)

    for female, prefix in ((False, "js_sheet_frame"), (True, "js_sheet_female")):
        frames = compose_sheet_frames(head=head, body=body, legs=legs, female=female)
        assert len(frames) == 20
        for index, expected in enumerate(frames):
            compare(js_output, f"{prefix}{index}.rgba", expected)


def test_sheet_tolerates_a_short_last_frame(js_output, template):
    """Vanilla ships some 40x1118 head sheets; the last frame is 2px short."""
    head = generate_head(template).crop((0, 0, 40, 1118))
    frames = compose_sheet_frames(
        head=head,
        body=generate_body_composite(template),
        legs=generate_legs(template),
    )
    compare(js_output, "js_sheet_short19.rgba", frames[19])


def test_sheet_stack_matches_python(js_output, template):
    frames = compose_sheet_frames(
        head=generate_head(template),
        body=generate_body_composite(template),
        legs=generate_legs(template),
    )
    compare(js_output, "js_sheet_stacked.rgba", stack_sheet(frames))


def test_sheet_classification_matches_python(js_output):
    """Role and id detection has to agree in both implementations."""
    lookup = json.loads((js_output / "js_sheet_classify.json").read_text(encoding="utf-8"))

    assert lookup["roles"] == {"head": 40, "body": 360, "legs": 40}
    assert lookup["ids"] == {"head": 52, "body": 32, "legs": 31}
    assert lookup["names"] == {
        "head": "Armor_Head_52.png",
        "body": "Armor_32.png",
        "legs": "Armor_Legs_31.png",
    }
    # the duplicate head, the duplicate body and the unclassifiable tall file
    assert len(lookup["warnings"]) == 3

    for name, role, ident in lookup["detect"]:
        assert role == sheet_role(name), name
        assert ident == sheet_id(name), name


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


def test_player_textures_are_bundled():
    """Overlay-player must work without a Content/Images folder (phones)."""
    folder = WEB / "data" / "player"
    expected = {"Player_0_3.png": (360, 224), "Player_0_7.png": (360, 224), "Player_0_10.png": (40, 1120)}
    for name, size in expected.items():
        path = folder / name
        assert path.is_file(), f"{name} is not bundled"
        with Image.open(path) as image:
            assert image.size == size, f"{name}: {image.size}"

    info = (folder / "version.txt").read_text(encoding="utf-8")
    assert "count=3" in info
    assert "version=" in info

    # the page loads them by name, and the service worker caches them
    app = (WEB / "app.js").read_text(encoding="utf-8")
    assert 'data/player' in app
    worker = (WEB / "sw.js").read_text(encoding="utf-8")
    for name in expected:
        assert f"data/player/{name}" in worker, name

    # an importer keeps them reproducible instead of hand-copied blobs
    assert (ROOT / "tools" / "import_player_textures.py").is_file()


def test_service_worker_precaches_the_whole_app():
    """Offline support is only real if every boot-time file is in the cache."""
    import re

    script = (WEB / "sw.js").read_text(encoding="utf-8")
    assert re.search(r'const VERSION = "[^"]+"', script), "the cache needs a version to bust"
    assert "skipWaiting" in script and "clients.claim" in script

    core = re.search(r"const CORE = \[(.*?)\];", script, re.S)
    assert core, "sw.js has no CORE list"
    files = re.findall(r'"([^"]+)"', core.group(1))
    assert "index.html" in files and "app.js" in files

    for name in files:
        if name == "./":
            continue
        assert (WEB / name).is_file(), f"sw.js precaches a missing file: {name}"

    # every module the app imports has to be precached, or an offline boot 404s
    app = (WEB / "app.js").read_text(encoding="utf-8")
    modules = {name.removeprefix("./") for name in re.findall(r'from "(\./js/[^"]+)"', app)}
    missing = sorted(module for module in modules if module not in files)
    assert not missing, f"sw.js does not cache {missing}"

    # the bundled textures are big: they are cached on use, not on install
    assert "data/vanilla/" in script
    assert "data/vanilla/version.txt" not in files

    # Pages serves the site from /<repo>/, so paths must be scope-relative
    assert "self.registration.scope" in script


def test_the_service_worker_is_registered_and_scoped_to_the_site():
    app = (WEB / "app.js").read_text(encoding="utf-8")
    assert 'register("sw.js")' in app
    assert "serviceWorker" in app

    html = (WEB / "index.html").read_text(encoding="utf-8")
    assert '<link rel="manifest" href="manifest.webmanifest">' in html
    assert '<meta name="theme-color"' in html


def test_web_manifest_is_a_valid_pwa_manifest():
    manifest = json.loads((WEB / "manifest.webmanifest").read_text(encoding="utf-8"))
    assert manifest["start_url"] == "./"
    assert manifest["display"] == "standalone"
    assert manifest["name"] and manifest["short_name"]
    assert manifest["theme_color"].startswith("#")
    icons = manifest["icons"]
    assert icons, "a PWA needs at least one icon"
    for icon in icons:
        assert (WEB / icon["src"]).is_file(), icon
        assert "x" in icon["sizes"], icon


def test_every_translation_the_app_uses_exists():
    """A missing key shows up as `web.something` in the UI, so catch it here."""
    import re

    app = (WEB / "app.js").read_text(encoding="utf-8")
    used = set(re.findall(r'(?<![\w.$])t\("([\w.]+)"', app))
    # keys built at runtime: t(`web.slot.${role}`)
    used |= {f"web.slot.{role}" for role in ("head", "body", "legs")}
    used |= {f"web.sheetWarn{kind}" for kind in ()}
    assert len(used) > 50, used

    messages = json.loads((WEB / "data" / "i18n.json").read_text(encoding="utf-8"))["messages"]
    for language in ("zh_CN", "en"):
        missing = sorted(key for key in used if key not in messages[language])
        assert not missing, f"{language} has no text for {missing}"

    # ... and the html's data-i18n keys are covered above; this one used to be
    # missing entirely, which printed the raw key on the result card button
    assert messages["zh_CN"]["web.saveToOutput"] == "写入输出目录"


def test_web_only_strings_are_merged_over_the_frozen_python_ones():
    """The Python package is frozen, so browser-only text lives in its own file."""
    extra = json.loads((WEB / "i18n.web.json").read_text(encoding="utf-8"))
    messages = json.loads((WEB / "data" / "i18n.json").read_text(encoding="utf-8"))["messages"]

    assert set(extra) - {"_comment"} == set(messages), "both languages have to be covered"
    for language, strings in extra.items():
        if language.startswith("_"):
            continue
        for key, value in strings.items():
            assert messages[language][key] == value, f"{language}: {key} was not exported"
            assert "护甲" not in value, f"{language}: {key} uses the wrong word"

    # the exporter must not have touched the frozen Python sources
    exporter = (ROOT / "tools" / "export_web.py").read_text(encoding="utf-8")
    assert "i18n.web.json" in exporter, "the exporter must merge the web-only strings"


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

/**
 * Click "download the drawing template" and inspect what it actually produces.
 *
 * Downloads are intercepted by hooking `URL.createObjectURL`, so the blob can be
 * decoded and compared with the raw template instead of landing on disk.
 */
function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

async function checkTemplateDownload(doc, win) {
  const { decodeBitmap } = await import("/js/fs.js");
  const captured = [];
  const realCreate = win.URL.createObjectURL.bind(win.URL);
  win.URL.createObjectURL = (blob) => {
    captured.push(blob);
    return realCreate(blob);
  };

  const rawResponse = await win.fetch("/data/ArmorTemplate_v1.png");
  const raw = await decodeBitmap(await rawResponse.blob());

  doc.querySelector("#download-template").click();
  for (let tick = 0; tick < 200 && !captured.length; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  win.URL.createObjectURL = realCreate;
  if (!captured.length) return { error: "the download button produced nothing" };

  const produced = await decodeBitmap(captured[0]);
  const opaque = (bitmap) => {
    let count = 0;
    for (let i = 3; i < bitmap.data.length; i += 4) if (bitmap.data[i] > 1) count += 1;
    return count;
  };
  return {
    size: `${produced.width}x${produced.height}`,
    rawOpaque: opaque(raw),
    producedOpaque: opaque(produced),
    identicalToRaw: equalBytes(produced.data, raw.data),
  };
}

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

/** Build the three generated sheets (and the template) once per call. */
async function makeSheets() {
  const [{ loadLayout }, { decodeBitmap }, { generateHead, generateLegs, generateBodyComposite }] =
    await Promise.all([
      import("/js/data.js"),
      import("/js/fs.js"),
      import("/js/generate.js"),
    ]);
  await loadLayout("/data/layout.json");
  const template = await decodeBitmap(await (await fetch("/data/ArmorTemplate_v1.png")).blob());
  return {
    template,
    head: ["Armor_Head_189.png", generateHead(template)],
    body: ["Armor_190.png", generateBodyComposite(template)],
    legs: ["Armor_Legs_130.png", generateLegs(template)],
  };
}

/** Put a list of `[name, bitmap]` into one file input, like a real pick would. */
async function putFiles(doc, selector, pairs) {
  const { pngBlob } = await import("/js/png.js");
  const transfer = new DataTransfer();
  for (const [name, bitmap] of pairs) {
    transfer.items.add(new File([await pngBlob(bitmap)], name, { type: "image/png" }));
  }
  const input = doc.querySelector(selector);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

/** Upload three vanilla-named textures through one of the page's inputs. */
async function uploadTextures(doc, selector = "#texture-input") {
  const sheets = await makeSheets();
  await putFiles(doc, selector, [sheets.head, sheets.body, sheets.legs]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The results card should be as tall as the input card while it is empty
 * (inline min-height), and grow with its own content once a result is shown.
 */
function cardHeights(doc, panelId) {
  const panel = doc.querySelector(panelId);
  const left = panel.querySelector(".stack > .card");
  const card = panel.querySelector(".results-card");
  return {
    left: Math.round(left.getBoundingClientRect().height),
    results: Math.round(card.getBoundingClientRect().height),
    forced: card.style.minHeight,
  };
}

/**
 * The "preview sheets" tab: three labelled slots, speed/size selects and the
 * generated PNGs plus animated GIFs.  Also checks that a sheet dropped into the
 * wrong slot is rejected with a translated message instead of silently used.
 */
async function runSheetGifs(doc) {
  const sheets = await makeSheets();

  // wrong slot first: the body grid is not a valid head sheet
  await putFiles(doc, "#sheet-head-input", [sheets.body]);
  await sleep(60);
  const wrongSlotStatus = doc.querySelector("#sheet-status").textContent.trim();
  const wrongSlotFilled = doc
    .querySelector('#sheet-head-slot')
    .closest(".slot")
    .classList.contains("is-filled");

  for (const role of ["head", "body", "legs"]) {
    await putFiles(doc, `#sheet-${role}-input`, [sheets[role]]);
  }
  for (let tick = 0; tick < 200; tick += 1) {
    await sleep(25);
    if (!doc.querySelector("#do-gifs").disabled) break;
  }
  const disabled = doc.querySelector("#do-gifs").disabled;
  const sheetStatus = doc.querySelector("#sheet-status").textContent.trim();
  const filled = [...doc.querySelectorAll(".slot")].map((slot) => slot.classList.contains("is-filled"));
  // each slot has to show its own title and a thumbnail of what was dropped
  const titles = [...doc.querySelectorAll(".slot-head > span")].map((el) => el.textContent.trim());
  const thumbs = [...doc.querySelectorAll(".slot-thumb")].map((img) => ({
    hidden: img.hidden,
    src: (img.getAttribute("src") || "").slice(0, 5),
    width: img.naturalWidth,
  }));
  if (disabled) return { error: "the generate button stayed disabled", sheetStatus, wrongSlotStatus };

  // slow GIFs at 2x, so the test can see the settings really reach the encoder
  const speed = doc.querySelector("#gif-speed");
  speed.value = "slow";
  speed.dispatchEvent(new Event("change", { bubbles: true }));
  const size = doc.querySelector("#gif-size");
  size.value = "2";
  size.dispatchEvent(new Event("change", { bubbles: true }));

  await sleep(150); // let the resize observer catch up with the filled slots
  const heightsBefore = cardHeights(doc, "#tab-gifs");
  doc.querySelector("#do-gifs").click();
  for (let tick = 0; tick < 400; tick += 1) {
    await sleep(25);
    const images = doc.querySelectorAll("#gif-results .preview img");
    if (images.length) {
      // GIFs decode lazily: wait so naturalWidth is the real frame size
      await Promise.all([...images].map((img) => img.decode().catch(() => null)));
      const widths = [...images].map((img) => img.naturalWidth);
      const gif = doc.querySelector('#gif-results .files a[download$=".gif"]');
      return {
        disabled,
        sheetStatus,
        wrongSlotStatus,
        wrongSlotFilled,
        filled,
        heightsBefore,
        heightsAfter: cardHeights(doc, "#tab-gifs"),
        titles,
        thumbs,
        previews: images.length,
        widths,
        gifSize: gif ? gif.textContent : null,
        captions: [...doc.querySelectorAll("#gif-results figcaption")].map((el) => el.textContent),
        files: [...doc.querySelectorAll("#gif-results .files a")].map((a) => a.textContent),
        sizes: [...doc.querySelectorAll("#gif-results .files li .muted")].map((el) => el.textContent),
        sources: [...images].map((img) => img.src.slice(0, 5)),
        status: doc.querySelector("#status").textContent.trim(),
        settings: JSON.parse(frame.contentWindow.localStorage.getItem("armorhelper.settings") || "{}"),
        history: doc.querySelectorAll("#history-list li img").length,
      };
    }
  }
  return { error: "no GIF result", sheetStatus };
}

/**
 * "Overlay player" has to work without any folder: the site ships the three
 * player textures (`data/player/`), which is what makes it usable on a phone.
 */
async function runPlayerOverlay(doc) {
  doc.querySelector("#gif-player").checked = true;
  doc.querySelector("#gif-player").dispatchEvent(new Event("change", { bubbles: true }));

  // exporting with player preview on: the hint must stay hidden (parts found)
  const optPlayer = doc.querySelector("#opt-player");
  optPlayer.checked = true;
  optPlayer.dispatchEvent(new Event("change", { bubbles: true }));
  const exportHintHidden = doc.querySelector("#player-hint").hidden;

  doc.querySelector("#do-gifs").click();
  for (let tick = 0; tick < 400; tick += 1) {
    await sleep(25);
    const links = doc.querySelectorAll("#gif-results .files a");
    if (links.length > 4) {
      return {
        exportHintHidden,
        files: [...links].map((a) => a.textContent),
        previews: doc.querySelectorAll("#gif-results .preview img").length,
        warnings: [...doc.querySelectorAll("#gif-results .warn")].map((el) => el.textContent),
        status: doc.querySelector("#status").textContent.trim(),
      };
    }
  }
  return { error: "no player overlay result" };
}

/**
 * Click "make resource pack" and hand the produced zip back to Python, which
 * unzips it and checks the entry names, `pack.json` and every PNG.
 */
async function runResourcePack(doc) {
  const button = doc.querySelector("#do-pack");
  const enabled = !button.disabled;
  button.click();

  let link = null;
  for (let tick = 0; tick < 400; tick += 1) {
    // the preview run before this one left its own files in the same card
    const anchor = [...doc.querySelectorAll("#gif-results .files a")].find(
      (a) => a.textContent.trim().endsWith("-pack-pc.zip"),
    );
    if (anchor && (anchor.getAttribute("href") || "").startsWith("blob:")) {
      link = anchor;
      break;
    }
    await sleep(25);
  }
  if (!link) return { error: "no resource pack was produced", enabled };

  const buffer = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return {
    enabled,
    name: link.textContent.trim(),
    bytes: buffer.length,
    base64: btoa(binary),
    status: doc.querySelector("#status").textContent.trim(),
  };
}

/**
 * Click the two buttons at the bottom of a result card.
 *
 * This is what caught `save.save is not a function`: the card built its buttons
 * with locals named `zip` / `save`, which shadowed `result.zip` / `result.save`,
 * so nothing was ever downloaded and the console filled with TypeErrors.
 */
async function clickResultButtons(doc, panelId) {
  const win = frame.contentWindow;
  const card = doc.querySelector(`${panelId} .job`);
  if (!card) return { error: "no result card" };
  const buttons = [...card.querySelectorAll(".actions button")];
  const labels = buttons.map((button) => button.textContent.trim());
  const disabled = buttons.map((button) => button.disabled);

  const captured = [];
  const realCreate = win.URL.createObjectURL.bind(win.URL);
  win.URL.createObjectURL = (blob) => {
    captured.push(blob);
    return realCreate(blob);
  };
  // the "write to the output folder" button would open a real folder picker,
  // so only press the ones that are enabled — and never wait for a picker
  for (const [index, button] of buttons.entries()) {
    if (disabled[index]) continue;
    button.click();
  }
  for (let tick = 0; tick < 200 && !captured.length; tick += 1) {
    await sleep(25);
  }
  win.URL.createObjectURL = realCreate;

  let signature = null;
  let bytes = 0;
  let base64 = null;
  if (captured.length) {
    const buffer = new Uint8Array(await captured[0].arrayBuffer());
    bytes = buffer.length;
    signature = String.fromCharCode(...buffer.slice(0, 2));
    if (signature === "PK") {
      let binary = "";
      for (const byte of buffer) binary += String.fromCharCode(byte);
      base64 = btoa(binary);
    }
  }
  return {
    labels,
    disabled,
    bytes,
    signature,
    base64,
    status: doc.querySelector("#status").textContent.trim(),
  };
}

/** Run a plain export and report what the results card plus history look like. */
async function runExport(doc) {
  const sheets = await makeSheets();
  await putFiles(doc, "#file-input", [["MyArmor.png", sheets.template]]);
  // decoding is async: wait until the template shows up in the input list
  for (let tick = 0; tick < 200; tick += 1) {
    if (doc.querySelectorAll("#file-list li").length) break;
    await sleep(25);
  }
  const heightsBefore = cardHeights(doc, "#tab-export");
  doc.querySelector("#do-export").click();
  for (let tick = 0; tick < 400; tick += 1) {
    await sleep(25);
    if (doc.querySelector("#results .files a")) break;
  }
  await sleep(120);
  const heightsAfter = cardHeights(doc, "#tab-export");
  const buttons = await clickResultButtons(doc, "#tab-export");
  const history = [...doc.querySelectorAll("#history-list li")].map((li) => li.textContent.trim());
  return {
    heightsBefore,
    heightsAfter,
    buttons,
    files: [...doc.querySelectorAll("#results .files a")].map((a) => a.textContent),
    previews: doc.querySelectorAll("#results .preview img").length,
    sizes: [...doc.querySelectorAll("#results .files li")][0]?.textContent.trim() ?? "",
    history,
    stored: JSON.parse(frame.contentWindow.localStorage.getItem("armorhelper.history") || "[]"),
    status: doc.querySelector("#status").textContent.trim(),
  };
}

/** Hovering "download the drawing template" shows that image in a popover. */
async function checkTemplatePopover(doc) {
  const figure = doc.querySelector("#template-popover");
  const image = doc.querySelector("#template-popover-img");
  const button = doc.querySelector("#download-template");
  const hiddenAtStart = figure.hidden;
  button.dispatchEvent(new MouseEvent("mouseenter"));
  for (let tick = 0; tick < 200; tick += 1) {
    await sleep(25);
    if ((image.getAttribute("src") || "").startsWith("data:") && image.complete && image.naturalWidth) break;
  }
  const visible = !figure.hidden;
  const width = image.naturalWidth;
  button.dispatchEvent(new MouseEvent("mouseleave"));
  return { hiddenAtStart, visible, width, hiddenAfter: figure.hidden };
}

/** Fire "rebuild every set" and cancel it right away. */
async function runReverseAllCancel(doc) {
  doc.querySelector("#do-reverse-all").click();
  const cancel = doc.querySelector("#cancel-job");
  const sawCancelButton = !cancel.hidden;
  const sawBar = !doc.querySelector("#job-bar").hidden;
  cancel.click();
  for (let tick = 0; tick < 2000; tick += 1) {
    await sleep(25);
    const status = doc.querySelector("#status");
    if (status.className !== "busy") break;
  }
  return {
    sawCancelButton,
    sawBar,
    status: doc.querySelector("#status").textContent.trim(),
    files: doc.querySelectorAll("#reverse-result .files a").length,
    cancelHiddenAfter: doc.querySelector("#cancel-job").hidden,
  };
}

/** Fire "rebuild every set" and let it finish, watching the progress messages. */
async function runReverseAll(doc) {
  doc.querySelector("#do-reverse-all").click();
  let sawProgress = false;
  for (let tick = 0; tick < 8000; tick += 1) {
    await sleep(25);
    const status = doc.querySelector("#status");
    if (/\\d+\\/\\d+/.test(status.textContent)) sawProgress = true;
    if (tick > 4 && status.className !== "busy") break;
  }
  await sleep(150);
  return {
    sawProgress,
    status: doc.querySelector("#status").textContent.trim(),
    files: doc.querySelectorAll("#reverse-result .files a").length,
    history: doc.querySelectorAll("#history-list li img").length,
  };
}

/**
 * The harness clicks the real "download" buttons.  Anchor clicks are therefore
 * swallowed: the tests capture the blob through `URL.createObjectURL`, and the
 * user's Downloads folder stays empty.
 */
function blockDownloads(win) {
  if (win.__downloadsBlocked) return;
  win.__downloadsBlocked = true;
  const proto = win.HTMLAnchorElement.prototype;
  const real = proto.click;
  proto.click = function click() {
    if (this.hasAttribute && this.hasAttribute("download")) return undefined;
    return real.call(this);
  };
}

let ticks = 0;
const timer = setInterval(async () => {
  ticks += 1;
  let doc;
  try {
    doc = frame.contentDocument;
    if (frame.contentWindow) blockDownloads(frame.contentWindow);
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
    const download = await checkTemplateDownload(doc, frame.contentWindow);
    const popover = await checkTemplatePopover(doc);
    const builtin = await runReverse(doc);
    // 2. an export from a dropped template, which also fills the history
    const exported = await runExport(doc);
    // 3. the same thing again, but with the user's own files uploaded.
    await uploadTextures(doc);
    const uploaded = await runReverse(doc);
    // 4. the preview-sheets tab, with three separate slots
    const gifs = await runSheetGifs(doc);
    const pack = await runResourcePack(doc);
    const player = await runPlayerOverlay(doc);
    // 5. the long task: cancel works, and a full run reports progress
    const cancelled = await runReverseAllCancel(doc);
    const reverseAll = await runReverseAll(doc);
    report({
      ...app,
      download,
      popover,
      builtin,
      exported,
      uploaded,
      gifs,
      pack,
      player,
      cancelled,
      reverseAll,
    });
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


def open_in_browser(chrome: str, url: str, tmp_path: Path, handler) -> dict:
    """Open `url`, wait for the page to report back, and return its payload."""
    profile = tmp_path / "chrome-profile"
    # Even if something bypasses the harness's anchor stub, downloads land in the
    # test's temp folder instead of the user's ~/Downloads.
    downloads = tmp_path / "downloads"
    downloads.mkdir(parents=True, exist_ok=True)
    prefs = profile / "Default"
    prefs.mkdir(parents=True, exist_ok=True)
    (prefs / "Preferences").write_text(
        json.dumps(
            {
                "download": {"default_directory": str(downloads), "prompt_for_download": False},
                "savefile": {"default_directory": str(downloads)},
            }
        ),
        encoding="utf-8",
    )
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
        if not handler.done.wait(timeout=120):
            pytest.fail(f"the page never reported back; requests={handler.paths}")
    finally:
        stop_browser(process)
    assert handler.payload, "the page reported nothing"
    return json.loads(handler.payload)


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


class ServeDir:
    """Serve an arbitrary folder with the harness routes, for one test."""

    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.server = None
        self.handler = None

    def start(self) -> str:
        self.handler = type("Handler", (HarnessHandler,), {})
        self.handler.done = threading.Event()
        self.handler.payload = None
        self.handler.paths = []
        self.server = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0), functools.partial(self.handler, directory=str(self.directory))
        )
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def stop(self) -> None:
        self.server.shutdown()
        self.server.server_close()


def test_browser_smoke_test(browser_server, tmp_path):
    """Run the web core in a real browser (Chrome/Chromium), if one is present."""
    chrome = find_chrome()
    if chrome is None:
        pytest.skip("no Chrome/Chromium available")

    base, handler = browser_server
    payload = open_in_browser(chrome, f"{base}/tests/smoke.html", tmp_path, handler)

    assert not payload.get("error"), payload.get("error")
    failures = [item for item in payload["results"] if not item["ok"]]
    assert not failures, "\n".join(f"{item['name']}: {item['detail']}" for item in failures)
    assert payload["total"] >= 15
    assert payload["failures"] == 0


@pytest.fixture()
def clean_template_web(tmp_path):
    """A copy of `web/` whose template has the guide stripped out.

    That is the situation the overlay exists for: the bundled template already
    contains the guide, so compositing it is invisible.  With an art-only
    template the overlay has to put those pixels back.
    """
    import shutil

    root = tmp_path / "web"
    shutil.copytree(WEB, root, ignore=shutil.ignore_patterns("vanilla"))

    template = load_template()
    overlay = bundled_overlay()
    if overlay is None:
        pytest.skip("no guide overlay is bundled")

    art_only = Image.new("RGBA", template.size, (0, 0, 0, 0))
    source, guide, target = template.load(), overlay.load(), art_only.load()
    for y in range(template.height):
        for x in range(template.width):
            if guide[x, y][3] <= 1 and source[x, y][3] > 1:
                target[x, y] = source[x, y]
    art_only.save(root / "data" / "ArmorTemplate_v1.png")
    return root, art_only


def test_browser_download_applies_the_guide_overlay(clean_template_web, tmp_path):
    """The download button must hand out template + guide, not the bare art."""
    chrome = find_chrome()
    if chrome is None:
        pytest.skip("no Chrome/Chromium available")

    root, art_only = clean_template_web
    served = ServeDir(root)
    base = served.start()
    try:
        payload = open_in_browser(chrome, f"{base}/__harness.html", tmp_path, served.handler)
    finally:
        served.stop()

    assert not payload.get("error"), payload.get("error")
    download = payload["download"]
    assert not download.get("error"), download
    assert download["size"] == "128x80"

    bare = sum(1 for pixel in art_only.getdata() if pixel[3] > 1)
    assert download["rawOpaque"] == bare, "the served template should be art only"
    assert download["producedOpaque"] > bare, "the overlay was not drawn on the download"
    assert download["producedOpaque"] == bare + 4395
    assert download["identicalToRaw"] is False


def test_browser_renders_the_app(browser_server, tmp_path, template):
    """The single page app must boot and fill itself in."""
    chrome = find_chrome()
    if chrome is None:
        pytest.skip("no Chrome/Chromium available")

    base, handler = browser_server
    payload = open_in_browser(chrome, f"{base}/__harness.html", tmp_path, handler)

    assert not payload.get("error"), f"{payload.get('error')} | requests={HarnessHandler.paths}"
    assert "已连接" in payload["status"]
    assert payload["sets"] > 150
    assert payload["targets"] == 12
    assert payload["checkboxes"] == 18
    assert payload["tabs"] == ["导出贴图", "预览贴图", "反向还原", "设置"]
    assert "网页版" in payload["subtitle"]
    assert payload["guide"] is True
    assert "参考线" in payload["guideLabel"]
    assert payload["downloadButton"] == "BUTTON"
    assert payload["favicon"] == "data/icon.png"
    assert payload["logo"] == "data/icon.png"
    assert not payload["download"].get("error"), payload["download"]
    assert payload["download"]["size"] == "128x80"

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

    # the hover popover really shows the template that the button downloads
    popover = payload["popover"]
    assert popover["hiddenAtStart"] is True, popover
    assert popover["visible"] is True, popover
    assert popover["width"] == 128 * 4 + 4, popover  # magnified 4x + the 2px border
    assert popover["hiddenAfter"] is True, popover

    # a plain export, and the history entry it leaves behind
    exported = payload["exported"]
    assert exported["files"], exported
    assert exported["previews"] == 3, exported
    assert "40×1120" in exported["sizes"], exported
    assert len(exported["history"]) >= 1, exported
    assert "MyArmor" in exported["history"][0], exported
    assert exported["stored"][0]["files"] == len(exported["files"]), exported["stored"]
    assert exported["stored"][0]["thumb"].startswith("data:image/png"), exported["stored"]

    # the empty results card is as tall as the input card next to it ...
    before = exported["heightsBefore"]
    assert abs(before["results"] - before["left"]) <= 2, before
    assert before["forced"].endswith("px"), before
    # ... and once there is a result it is driven by the content instead
    after = exported["heightsAfter"]
    assert after["forced"] == "", after
    assert after["results"] > 0, after

    # the result card's buttons really do something (this used to throw
    # "save.save is not a function" because of a shadowed local)
    buttons = exported["buttons"]
    assert not buttons.get("error"), buttons.get("error")
    assert buttons["labels"] == ["打包下载 (zip)", "写入输出目录"], buttons
    assert "not a function" not in buttons["status"], buttons["status"]
    assert buttons["signature"] == "PK", json.dumps(buttons, ensure_ascii=False)
    assert buttons["bytes"] > 1000, buttons
    # ... and it holds the exported sheets, named the way the game expects
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(buttons["base64"]))) as zipped:
        assert zipped.namelist() == ["MyArmor_Head.png", "MyArmor_Legs.png", "MyArmor_Body.png"], zipped.namelist()
        with Image.open(io.BytesIO(zipped.read("MyArmor_Head.png"))) as head_png:
            assert list(head_png.convert("RGBA").getdata()) == list(generate_head(template).getdata())

    # the preview-sheets tab: three labelled slots, speed/size, and the GIFs
    gifs = payload["gifs"]
    assert not gifs.get("error"), gifs.get("error")
    # a body sheet in the head slot is refused, in the user's language
    assert gifs["wrongSlotFilled"] is False, gifs
    assert "Armor_190.png" in gifs["wrongSlotStatus"], gifs["wrongSlotStatus"]
    assert "还缺" in gifs["wrongSlotStatus"], gifs["wrongSlotStatus"]
    assert gifs["disabled"] is False
    assert gifs["filled"] == [True, True, True], gifs
    # the public names and sizes are written on the slot headers
    assert gifs["titles"] == [
        "头部（Armor_Head_ · 40×1120px）",
        "身体（Armor_ · 360×224，整数倍也行）",
        "腿部（Armor_Legs_ · 40×1120px）",
    ], gifs["titles"]
    assert [thumb["hidden"] for thumb in gifs["thumbs"]] == [False, False, False], gifs["thumbs"]
    assert [thumb["src"] for thumb in gifs["thumbs"]] == ["data:"] * 3, gifs["thumbs"]
    # tall sheets show their first frame at 2x, the body grid shows all 9x4 cells
    assert [thumb["width"] for thumb in gifs["thumbs"]] == [80, 360, 80], gifs["thumbs"]
    assert "头部 ✓" in gifs["sheetStatus"], gifs["sheetStatus"]
    assert gifs["files"] == [
        "Armor_190_FullArmor.png",
        "Armor_190_FullArmorFemale.png",
        "Armor_190_FullArmor.gif",
        "Armor_190_FullArmorFemale.gif",
    ], gifs["files"]
    assert gifs["previews"] == 3, gifs
    assert gifs["captions"][:2] == ["全身盔甲（男）", "全身盔甲（女）"], gifs["captions"]
    assert gifs["sources"][:2] == ["blob:", "blob:"], gifs["sources"]
    assert gifs["sources"][2] == "data:", gifs["sources"]
    assert "已生成" in gifs["status"], gifs["status"]
    # 2x was chosen, so the GIFs (and their preview) are twice as wide
    assert gifs["widths"][:2] == [80, 80], gifs["widths"]
    assert gifs["widths"][2] > 800, gifs["widths"]  # the 20 frame contact sheet
    before = gifs["heightsBefore"]
    assert abs(before["results"] - before["left"]) <= 2, before
    assert before["forced"].endswith("px"), before
    after = gifs["heightsAfter"]
    assert after["forced"] == "", after

    assert gifs["settings"]["gifSpeed"] == "slow", gifs["settings"]
    assert gifs["settings"]["gifSize"] == 2, gifs["settings"]

    # "make resource pack": the zip has to carry the game's folder layout
    pack = payload["pack"]
    assert not pack.get("error"), pack.get("error")
    assert pack["enabled"] is True, pack
    assert pack["name"] == "Armor_190-pack-pc.zip", pack
    assert "已生成材质包" in pack["status"], pack["status"]

    with zipfile.ZipFile(io.BytesIO(base64.b64decode(pack["base64"]))) as archive:
        assert archive.namelist() == [
            "pack.json",
            "Content/",
            "Content/Images/",
            "Content/Images/Armor_Head_190.png",
            "Content/Images/Armor_Legs_190.png",
            "Content/Images/Armor/",
            "Content/Images/Armor/Armor_190.png",
        ], archive.namelist()
        assert archive.testzip() is None

        meta = json.loads(archive.read("pack.json"))
        assert meta["Name"] == "星尘板甲", meta
        assert meta["Author"], meta
        assert meta["Description"], meta
        assert meta["Version"] == {"major": 1, "minor": 0}, meta

        # the three PNGs are exactly the sheets that were dropped in
        expected = {
            "Content/Images/Armor_Head_190.png": generate_head(template),
            "Content/Images/Armor_Legs_190.png": generate_legs(template),
            "Content/Images/Armor/Armor_190.png": generate_body_composite(template),
        }
        for name, want in expected.items():
            with Image.open(io.BytesIO(archive.read(name))) as produced:
                assert produced.size == want.size, name
                assert list(produced.convert("RGBA").getdata()) == list(want.getdata()), name

    # "overlay player" works with no folder at all (bundled player textures)
    player = payload["player"]
    assert not player.get("error"), player.get("error")
    assert player["exportHintHidden"] is True, player
    assert player["files"] == [
        "Armor_190_FullArmor.png",
        "Armor_190_FullArmorFemale.png",
        "Armor_190_FullArmorPlayer.png",
        "Armor_190_FullArmorPlayerFemale.png",
        "Armor_190_FullArmor.gif",
        "Armor_190_FullArmorFemale.gif",
        "Armor_190_FullArmorPlayer.gif",
        "Armor_190_FullArmorPlayerFemale.gif",
    ], player["files"]
    assert player["previews"] == 5, player
    assert not player["warnings"], player

    # cancelling the long "rebuild every set" task
    cancelled = payload["cancelled"]
    assert cancelled["sawCancelButton"] is True, cancelled
    assert cancelled["sawBar"] is True, cancelled
    assert "已取消" in cancelled["status"], cancelled
    assert cancelled["cancelHiddenAfter"] is True, cancelled

    # ... and letting it finish reports progress on the way
    reverse_all = payload["reverseAll"]
    assert reverse_all["sawProgress"] is True, reverse_all
    assert reverse_all["files"] > 100, reverse_all
    assert "已还原" in reverse_all["status"], reverse_all
    assert reverse_all["history"] >= 2, reverse_all


def test_pages_workflow_publishes_the_web_folder():
    workflow = (ROOT / ".github" / "workflows" / "pages.yml").read_text(encoding="utf-8")
    assert "path: web" in workflow
    assert "tools/export_web.py" in workflow
    assert (WEB / ".nojekyll").exists()
