"""Tests for the web front end.

They start the real HTTP server on an ephemeral port and talk to it over a
socket, so the routes, JSON shapes and binary responses are all covered.
"""

from __future__ import annotations

import base64
import json
import sys
import threading
import urllib.error
import urllib.request
from pathlib import Path

import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from armorhelper.generate import (  # noqa: E402
    generate_body_composite,
    generate_head,
    generate_legs,
)
from armorhelper.layout import load_template  # noqa: E402
from armorhelper.web.api import Api, ApiError  # noqa: E402
from armorhelper.web.server import make_server  # noqa: E402

TEMPLATE = ROOT / "armorhelper" / "data" / "ArmorTemplate_v1.png"


@pytest.fixture()
def api(tmp_path) -> Api:
    return Api(workspace=tmp_path / "jobs", config_path=tmp_path / "web-config.json")


@pytest.fixture()
def base(api):
    server = make_server("127.0.0.1", 0, api=api)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def get(url: str):
    with urllib.request.urlopen(url, timeout=20) as response:
        return response.status, response.headers.get("Content-Type"), response.read()


def get_json(url: str):
    status, _, body = get(url)
    return status, json.loads(body)


def post_json(url: str, payload: dict):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


# --------------------------------------------------------------------------- #
# Static assets and metadata
# --------------------------------------------------------------------------- #


def test_index_is_served(base):
    status, content_type, body = get(base + "/")
    assert status == 200
    assert content_type.startswith("text/html")
    assert b"ArmorHelper" in body


@pytest.mark.parametrize("asset", ["/static/app.js", "/static/style.css", "/static/favicon.png"])
def test_static_assets_are_served(base, asset):
    status, _, body = get(base + asset)
    assert status == 200 and body


def test_unknown_route_is_404(base):
    with pytest.raises(urllib.error.HTTPError) as info:
        get(base + "/api/nope")
    assert info.value.code == 404


def test_path_traversal_is_refused(base):
    for path in ("/static/../api.py", "/static/..%2fapi.py", "/api/job/x/../../etc/passwd"):
        with pytest.raises(urllib.error.HTTPError) as info:
            get(base + path)
        assert info.value.code in (400, 404)


def test_template_download(base):
    status, content_type, body = get(base + "/api/template")
    assert status == 200 and content_type == "image/png"
    import io

    assert Image.open(io.BytesIO(body)).size == (128, 80)


def test_frontend_is_wired_up():
    """Every element app.js looks up by id has to exist in index.html."""
    import re

    static = ROOT / "armorhelper" / "web" / "static"
    html = (static / "index.html").read_text(encoding="utf-8")
    script = (static / "app.js").read_text(encoding="utf-8")

    ids = set(re.findall(r'id="([^"]+)"', html))
    refs = set(re.findall(r'\$\("#([A-Za-z0-9_-]+)"\)', script))
    assert refs, "app.js should look elements up by id"
    assert not (refs - ids), f"app.js references missing ids: {sorted(refs - ids)}"

    # data-i18n keys must all exist in both languages
    from armorhelper.i18n import MESSAGES

    keys = set(re.findall(r'data-i18n(?:-placeholder)?="([^"]+)"', html))
    assert keys
    for language, table in MESSAGES.items():
        missing = sorted(key for key in keys if key not in table)
        assert not missing, f"{language} is missing {missing}"

    # no external requests (offline capable)
    for text in (html, script, (static / "style.css").read_text(encoding="utf-8")):
        assert "http://" not in text.replace("http://127.0.0.1", "")
        assert "https://" not in text


def test_i18n_and_targets(base):
    _, payload = get_json(base + "/api/i18n")
    assert "messages" in payload and "zh_CN" in payload["messages"]
    assert payload["messages"]["zh_CN"]["button.export"] == "导出"
    assert "body" in payload["targets"]

    _, target_payload = get_json(base + "/api/targets")
    assert target_payload["targets"] == payload["targets"]


# --------------------------------------------------------------------------- #
# Settings
# --------------------------------------------------------------------------- #


def test_state_round_trip(base, tmp_path):
    _, initial = get_json(base + "/api/state")
    assert initial["version"]
    assert "head" in initial["exportCheckbox"]

    folder = tmp_path / "out"
    folder.mkdir()
    status, payload = post_json(
        base + "/api/state",
        {
            "exportFolder": str(folder),
            "imagesFolder": str(folder),
            "glow": True,
            "skin": 3,
            "ids": {"id_body": "190"},
            "targets": {"legacy": True},
        },
    )
    assert status == 200
    assert payload["exportFolder"] == str(folder)
    assert payload["glow"] is True
    assert payload["skin"] == 3
    assert payload["ids"]["id_body"] == "190"
    assert payload["exportCheckbox"]["legacy"] is True

    _, again = get_json(base + "/api/state")
    assert again["exportFolder"] == str(folder)


def test_state_rejects_bad_payloads(base):
    status, payload = post_json(base + "/api/state", {"skin": "abc"})
    assert status == 400 and "skin" in payload["error"]


def test_settings_are_persisted_on_disk(base, api):
    post_json(base + "/api/state", {"glow": True})
    assert api.config_path.exists()
    assert json.loads(api.config_path.read_text(encoding="utf-8"))["glow"] is True


# --------------------------------------------------------------------------- #
# Vanilla browsing
# --------------------------------------------------------------------------- #


def test_sets_endpoint_search(base):
    _, payload = get_json(base + "/api/sets?q=" + urllib.parse.quote("星尘"))
    assert [item["body"] for item in payload["sets"]] == [190]
    assert payload["sets"][0]["label"].startswith("星尘板甲")
    assert payload["sets"][0]["complete"] is True

    _, all_sets = get_json(base + "/api/sets")
    assert len(all_sets["sets"]) > 150


def test_browse_endpoint(base, tmp_path):
    root = tmp_path / "tree"
    (root / "alpha").mkdir(parents=True)
    (root / "beta").mkdir()
    (root / ".hidden").mkdir()
    _, payload = get_json(base + "/api/browse?path=" + urllib.parse.quote(str(root)))
    assert payload["path"] == str(root)
    assert [item["name"] for item in payload["directories"]] == ["alpha", "beta"]
    assert payload["parent"] == str(root.parent)


def test_browse_falls_back_to_the_parent(base):
    _, payload = get_json(base + "/api/browse?path=/definitely/not/here")
    assert Path(payload["path"]).is_dir()


# --------------------------------------------------------------------------- #
# Export
# --------------------------------------------------------------------------- #


@pytest.fixture()
def vanilla_images(tmp_path):
    template = load_template(TEMPLATE)
    root = tmp_path / "Images"
    (root / "Armor").mkdir(parents=True)
    for body, head, legs in ((1, 1, 1), (7, 7, 7)):
        generate_head(template).save(root / f"Armor_Head_{head}.png")
        generate_legs(template).save(root / f"Armor_Legs_{legs}.png")
        generate_body_composite(template).save(root / "Armor" / f"Armor_{body}.png")
    return root


def test_generate_endpoint(base):
    data = base64.b64encode(TEMPLATE.read_bytes()).decode()
    status, payload = post_json(
        base + "/api/generate",
        {"files": [{"name": "MyArmor.png", "data": data}], "targets": ["head", "legs", "body"]},
    )
    assert status == 200
    job = payload["jobs"][0]
    names = {item["name"] for item in job["files"]}
    assert names == {"MyArmor_Head.png", "MyArmor_Legs.png", "MyArmor_Body.png"}
    assert job["preview"].startswith("/api/job/")
    assert job["gif"].endswith(".gif")
    assert job["written"] == []

    # every advertised file really downloads
    for item in job["files"]:
        status, _, body = get(base + item["url"])
        assert status == 200 and len(body) == item["size"]


def test_generate_preview_and_zip(base):
    data = base64.b64encode(TEMPLATE.read_bytes()).decode()
    _, payload = post_json(
        base + "/api/generate", {"files": [{"name": "X.png", "data": data}], "targets": ["body"]}
    )
    job = payload["jobs"][0]

    status, content_type, body = get(base + job["preview"])
    assert status == 200 and content_type == "image/png"
    import io

    preview = Image.open(io.BytesIO(body))
    # 20 frames, 10 per row, 3x scale, 2px gaps
    assert preview.width == 10 * 120 + 11 * 6
    assert preview.height == 2 * 168 + 3 * 6

    status, content_type, body = get(base + f"/api/job/{job['id']}/all.zip")
    assert status == 200 and content_type == "application/zip"
    import io
    import zipfile

    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        assert archive.namelist() == ["X_Body.png"]


def test_generate_zip_keeps_the_armor_subfolder(base):
    data = base64.b64encode(TEMPLATE.read_bytes()).decode()
    post_json(base + "/api/state", {
        "ids": {"id_head": "189", "id_body": "190", "id_legs": "130"}
    })
    _, payload = post_json(
        base + "/api/generate",
        {"files": [{"name": "S.png", "data": data}], "targets": ["head", "body"]},
    )
    job = payload["jobs"][0]
    urls = {item["relative"]: item["url"] for item in job["files"]}
    assert set(urls) == {"Armor_Head_189.png", "Armor/Armor_190.png"}
    for url in urls.values():
        assert get(base + url)[0] == 200

    import io
    import zipfile

    body = get(base + f"/api/job/{job['id']}/all.zip")[2]
    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        assert sorted(archive.namelist()) == ["Armor/Armor_190.png", "Armor_Head_189.png"]


def test_generate_writes_into_the_output_folder(base, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    post_json(base + "/api/state", {"exportFolder": str(out)})
    data = base64.b64encode(TEMPLATE.read_bytes()).decode()
    _, payload = post_json(
        base + "/api/generate", {"files": [{"name": "Y.png", "data": data}], "targets": ["head"]}
    )
    job = payload["jobs"][0]
    assert job["written"] == [str(out / "Y_Head.png")]
    assert (out / "Y_Head.png").exists()


def test_generate_uses_vanilla_names_when_ids_are_set(base, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    post_json(base + "/api/state", {"exportFolder": str(out), "ids": {"id_head": "189", "id_body": "190", "id_legs": "130"}})
    data = base64.b64encode(TEMPLATE.read_bytes()).decode()
    _, payload = post_json(
        base + "/api/generate",
        {"files": [{"name": "S.png", "data": data}], "targets": ["head", "legs", "body"]},
    )
    written = {Path(item).name for item in payload["jobs"][0]["written"]}
    assert written == {"Armor_Head_189.png", "Armor_Legs_130.png", "Armor_190.png"}


@pytest.mark.parametrize(
    "payload, fragment",
    [
        ({}, "no template"),
        ({"files": [{"name": "a.png", "data": "not base64!!"}]}, "base64"),
        ({"files": [{"name": "a.png", "data": base64.b64encode(b"nope").decode()}]}, "readable image"),
    ],
)
def test_generate_rejects_bad_input(base, payload, fragment):
    status, body = post_json(base + "/api/generate", payload)
    assert status == 400
    assert fragment in body["error"]


def test_generate_rejects_a_wrongly_sized_template(base):
    import io

    buffer = io.BytesIO()
    Image.new("RGBA", (64, 64)).save(buffer, "PNG")
    data = base64.b64encode(buffer.getvalue()).decode()
    status, body = post_json(base + "/api/generate", {"files": [{"name": "a.png", "data": data}]})
    assert status == 400
    assert "128x80" in body["error"]


# --------------------------------------------------------------------------- #
# Reverse
# --------------------------------------------------------------------------- #


def test_reverse_endpoint(base, vanilla_images, tmp_path):
    post_json(base + "/api/state", {"imagesFolder": str(vanilla_images)})
    status, payload = post_json(base + "/api/reverse", {"body": 1, "head": 1, "legs": 1})
    assert status == 200
    assert payload["kind"] == "reverse"
    assert payload["files"][0]["name"].startswith("ArmorTemplate_")

    status, _, body = get(base + payload["files"][0]["url"])
    import io

    assert Image.open(io.BytesIO(body)).size == (128, 80)
    assert payload["preview"]


def test_reverse_output_can_be_exported_again(base, vanilla_images):
    post_json(base + "/api/state", {"imagesFolder": str(vanilla_images)})
    _, payload = post_json(base + "/api/reverse", {"body": 1, "head": 1, "legs": 1})
    status, _, template = get(base + payload["files"][0]["url"])

    again = base64.b64encode(template).decode()
    status, generated = post_json(
        base + "/api/generate", {"files": [{"name": "Round.png", "data": again}], "targets": ["head"]}
    )
    assert status == 200
    assert generated["jobs"][0]["files"][0]["name"] == "Round_Head.png"


def test_reverse_needs_a_body(base, vanilla_images):
    post_json(base + "/api/state", {"imagesFolder": str(vanilla_images)})
    status, payload = post_json(base + "/api/reverse", {})
    assert status == 400


def test_reverse_needs_an_images_folder(base):
    post_json(base + "/api/state", {"imagesFolder": ""})
    status, payload = post_json(base + "/api/reverse", {"body": 1})
    assert status == 400


def test_reverse_all(base, vanilla_images, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    post_json(base + "/api/state", {"exportFolder": str(out), "imagesFolder": str(vanilla_images)})

    status, payload = post_json(base + "/api/reverse-all", {})
    assert status == 200
    assert payload["total"] == 2 and payload["failed"] == 0
    assert Path(payload["directory"]) == out / "ArmorTemplate"
    assert len(list((out / "ArmorTemplate").glob("*.png"))) == 2
    assert len(payload["files"]) == 2


def test_reverse_all_needs_an_output_folder(base, vanilla_images):
    post_json(base + "/api/state", {"imagesFolder": str(vanilla_images), "exportFolder": ""})
    status, payload = post_json(base + "/api/reverse-all", {})
    assert status == 400


# --------------------------------------------------------------------------- #
# Api object directly (no socket)
# --------------------------------------------------------------------------- #


def test_api_evicts_old_jobs(tmp_path):
    from armorhelper.web import api as api_module

    api = Api(workspace=tmp_path / "jobs", config_path=tmp_path / "c.json")
    for index in range(api_module.MAX_JOBS + 3):
        api._new_job(f"job{index}")
    assert len(api.jobs) <= api_module.MAX_JOBS


def test_api_job_file_rejects_separators(api):
    job = api._new_job("x")
    with pytest.raises(ApiError):
        api.job_file(job.id, "../secret")


def test_api_unknown_job(api):
    with pytest.raises(ApiError):
        api.job("nope")
