/* ArmorHelper web front end.  Plain ES2020, no build step, no dependencies. */
"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  messages: {},
  targets: [],
  defaults: [],
  config: {},
  files: [],        // {name, dataUrl, bytes}
  sets: [],
  browseTarget: null,
};

/* ------------------------------------------------------------- helpers -- */
const t = (key, vars) => {
  let text = (state.messages[key] ?? key);
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, v);
  return text;
};

function say(message, kind = "ok") {
  const el = $("#status");
  el.textContent = message;
  el.className = kind;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  if (response.status === 204) return null;
  const isJson = (response.headers.get("Content-Type") || "").includes("json");
  const payload = isJson ? await response.json() : await response.text();
  if (!response.ok) throw new Error(payload?.error || response.statusText);
  return payload;
}

const post = (path, body = {}) =>
  api(path, { method: "POST", body: JSON.stringify(body) });

function applyI18n() {
  document.documentElement.lang = state.config.language === "en" ? "en" : "zh-CN";
  for (const el of $$("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of $$("[data-i18n-placeholder]")) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
  document.title = `ArmorHelper ${state.config.version ?? ""} · ${t("web.subtitle")}`;
  renderTargets();
  renderFiles();
  renderResults(window.__lastJobs ?? []);
}

/* ------------------------------------------------------------ settings -- */
async function loadState() {
  const [i18n, state_] = await Promise.all([api("/api/i18n"), api("/api/state")]);
  state.messages = i18n.messages[state_.language || "zh_CN"] ?? i18n.messages.zh_CN;
  state.targets = i18n.targets;
  state.defaults = state_.defaults;
  state.config = state_;

  $("#language").value = state_.language || "zh_CN";
  $("#version").textContent = state_.version ?? "";

  $("#set-export").value = state_.exportFolder ?? "";
  $("#set-images").value = state_.imagesFolder ?? "";
  $("#set-head").value = state_.ids?.id_head ?? "";
  $("#set-body").value = state_.ids?.id_body ?? "";
  $("#set-legs").value = state_.ids?.id_legs ?? "";
  $("#set-skin").value = state_.skin ?? 0;
  $("#set-glow").checked = !!state_.glow;

  $("#rev-head").value = state_.ids?.id_head ?? "";
  $("#rev-body").value = state_.ids?.id_body ?? "";
  $("#rev-legs").value = state_.ids?.id_legs ?? "";
}

async function saveState(patch, { quiet = false } = {}) {
  const next = await post("/api/state", patch);
  state.messages = state.messages; // unchanged
  state.config = next;
  if (!quiet) say(t("web.saved"));
  return next;
}

function collectSettings() {
  const targets = {};
  for (const box of $$("#targets input")) targets[box.value] = box.checked;
  return {
    exportFolder: $("#set-export").value.trim(),
    imagesFolder: $("#set-images").value.trim(),
    glow: $("#set-glow").checked,
    skin: Number($("#set-skin").value || 0),
    targets,
    ids: {
      id_head: $("#set-head").value.trim(),
      id_body: $("#set-body").value.trim(),
      id_legs: $("#set-legs").value.trim(),
    },
  };
}

/* --------------------------------------------------------------- export -- */
function renderTargets() {
  const host = $("#targets");
  if (!host || !state.targets.length) return;
  const current = {};
  for (const box of $$("#targets input")) current[box.value] = box.checked;
  host.innerHTML = "";
  for (const name of state.targets) {
    const label = document.createElement("label");
    label.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = name;
    box.checked = name in current
      ? current[name]
      : (state.config.exportCheckbox?.[name] ?? state.defaults.includes(name));
    box.addEventListener("change", () =>
      saveState({ targets: { [name]: box.checked } }, { quiet: true }));
    const span = document.createElement("span");
    span.textContent = t(`target.${name}`);
    label.append(box, span);
    host.append(label);
  }
}

function renderFiles() {
  const list = $("#file-list");
  list.innerHTML = "";
  for (const [index, file] of state.files.entries()) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = file.name;
    const size = document.createElement("span");
    size.className = "muted";
    size.textContent = `${Math.round(file.bytes / 1024)} KB`;
    const remove = document.createElement("button");
    remove.textContent = "✕";
    remove.addEventListener("click", () => {
      state.files.splice(index, 1);
      renderFiles();
    });
    li.append(name, size, remove);
    list.append(li);
  }
  $("#file-summary").textContent = state.files.length
    ? t("web.selected", { count: state.files.length })
    : "";
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve({ name: file.name, dataUrl, base64: dataUrl.split(",", 2)[1], bytes: file.size });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function addFiles(fileList) {
  for (const file of fileList) {
    if (!/\.(png|bmp)$/i.test(file.name)) continue;
    state.files.push(await readFile(file));
  }
  renderFiles();
}

async function doExport() {
  if (!state.files.length) {
    say(t("web.drop"), "warn");
    return;
  }
  const targets = $$("#targets input").filter((box) => box.checked).map((box) => box.value);
  $("#do-export").disabled = true;
  say(t("web.exporting"), "busy");
  try {
    const payload = await post("/api/generate", {
      files: state.files.map((file) => ({ name: file.name, data: file.base64 })),
      targets,
      female: $("#opt-female").checked,
      player: $("#opt-player").checked,
    });
    window.__lastJobs = payload.jobs;
    renderResults(payload.jobs);
    say(t("status.done"), "ok");
  } catch (error) {
    say(String(error.message || error), "bad");
  } finally {
    $("#do-export").disabled = false;
  }
}

function jobCard(job) {
  const card = document.createElement("div");
  card.className = "job";

  const heading = document.createElement("h3");
  heading.textContent = `${job.name || job.kind}  ·  ${job.id}`;
  card.append(heading);

  if (job.preview) {
    const preview = document.createElement("div");
    preview.className = "preview";
    const img = document.createElement("img");
    img.src = job.preview;
    img.alt = t("web.previewSheet");
    img.loading = "lazy";
    preview.append(img);
    card.append(preview);
  }
  if (job.gif) {
    const gif = document.createElement("div");
    gif.className = "preview";
    const img = document.createElement("img");
    img.src = job.gif;
    img.alt = "GIF";
    img.loading = "lazy";
    gif.append(img);
    card.append(gif);
  }

  const list = document.createElement("ul");
  list.className = "files";
  for (const file of job.files) {
    const li = document.createElement("li");
    const link = document.createElement("a");
    link.href = file.url;
    link.download = file.name;
    link.textContent = file.name;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${file.width}×${file.height} · ${Math.round(file.size / 1024)} KB`;
    li.append(link, meta);
    list.append(li);
  }
  if (job.files.length) card.append(list);

  if (job.written?.length) {
    const written = document.createElement("p");
    written.className = "meta";
    written.textContent = `${t("web.written")} ${job.written.length}`;
    written.title = job.written.join("\n");
    card.append(written);
  }
  for (const warning of job.warnings ?? []) {
    const p = document.createElement("p");
    p.className = "warn";
    p.textContent = warning;
    card.append(p);
  }

  if (job.files.length) {
    const actions = document.createElement("div");
    actions.className = "actions";
    const zip = document.createElement("a");
    zip.className = "ghost link";
    zip.href = `/api/job/${job.id}/all.zip`;
    zip.textContent = t("web.downloadAll");
    actions.append(zip);
    card.append(actions);
  }
  return card;
}

function renderResults(jobs) {
  window.__lastJobs = jobs;
  const host = $("#results");
  if (!host) return;
  host.innerHTML = "";
  if (!jobs?.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = t("web.empty");
    host.append(p);
    return;
  }
  for (const job of jobs) host.append(jobCard(job));
}

/* -------------------------------------------------------------- reverse -- */
async function loadSets(query = "") {
  const payload = await api(`/api/sets?q=${encodeURIComponent(query)}`);
  state.sets = payload.sets;
  const select = $("#set-select");
  select.innerHTML = "";
  for (const [index, set] of state.sets.entries()) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${set.label}${set.complete ? "" : "  ⚠"}`;
    select.append(option);
  }
  if (state.sets.length) pickSet(0);
}

function pickSet(index) {
  const set = state.sets[index];
  if (!set) return;
  $("#rev-head").value = set.head ?? "";
  $("#rev-body").value = set.body ?? "";
  $("#rev-legs").value = set.legs ?? "";
}

async function doReverse() {
  const body = $("#rev-body").value.trim();
  if (!body) {
    say(t("reverse.badBody"), "warn");
    return;
  }
  say(t("web.working"), "busy");
  try {
    const job = await post("/api/reverse", {
      images: $("#set-images").value.trim(),
      body,
      head: $("#rev-head").value.trim(),
      legs: $("#rev-legs").value.trim(),
    });
    const host = $("#reverse-result");
    host.innerHTML = "";
    host.append(jobCard(job));
    say(t("reverse.done", { path: job.written?.[0] ?? job.files[0]?.name ?? "" }), "ok");
  } catch (error) {
    say(String(error.message || error), "bad");
  }
}

async function doReverseAll() {
  say(t("web.working"), "busy");
  $("#do-reverse-all").disabled = true;
  try {
    const result = await post("/api/reverse-all", { images: $("#set-images").value.trim() });
    const host = $("#reverse-result");
    host.innerHTML = "";
    host.append(jobCard(result));
    say(t("reverse.allDone", { count: result.total - result.failed, dir: result.directory }), "ok");
  } catch (error) {
    say(String(error.message || error), "bad");
  } finally {
    $("#do-reverse-all").disabled = false;
  }
}

/* -------------------------------------------------------------- browser -- */
let browseCallback = null;

async function openBrowser(targetId) {
  browseCallback = targetId ? () => $(`#${targetId}`) : null;
  const current = targetId ? $(`#${targetId}`).value.trim() : "";
  $("#browser").hidden = false;
  await browse(current);
}

async function browse(path) {
  try {
    const payload = await api(`/api/browse?path=${encodeURIComponent(path || "")}`);
    $("#browse-path").value = payload.path;
    $("#browse-path").dataset.path = payload.path;
    $("#browse-up").disabled = !payload.parent;
    $("#browse-up").dataset.parent = payload.parent ?? "";

    const shortcuts = $("#browse-shortcuts");
    shortcuts.innerHTML = "";
    for (const item of payload.shortcuts) {
      const button = document.createElement("button");
      button.className = "ghost";
      button.textContent = item;
      button.addEventListener("click", () => browse(item));
      shortcuts.append(button);
    }

    const list = $("#browse-list");
    list.innerHTML = "";
    for (const dir of payload.directories) {
      const li = document.createElement("li");
      li.textContent = `📁 ${dir.name}`;
      li.addEventListener("click", () => browse(dir.path));
      list.append(li);
    }
    if (!payload.directories.length) {
      const li = document.createElement("li");
      li.className = "muted";
      li.textContent = "(no sub folders)";
      list.append(li);
    }
  } catch (error) {
    say(String(error.message || error), "bad");
  }
}

/* ------------------------------------------------------------------ wire -- */
function wire() {
  // tabs
  for (const tab of $$(".tab")) {
    tab.addEventListener("click", () => {
      for (const other of $$(".tab")) other.classList.toggle("is-active", other === tab);
      for (const panel of $$(".panel")) {
        panel.classList.toggle("is-active", panel.id === `tab-${tab.dataset.tab}`);
      }
    });
  }

  // language
  $("#language").addEventListener("change", async (event) => {
    const language = event.target.value;
    await saveState({ language }, { quiet: true });
    state.messages = (await api("/api/i18n")).messages[language] ?? {};
    state.config.language = language;
    applyI18n();
    say(t("web.saved"));
  });

  // files
  const drop = $("#drop");
  const input = $("#file-input");
  drop.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    addFiles(input.files);
    input.value = "";
  });
  for (const type of ["dragenter", "dragover"]) {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add("is-over");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    drop.addEventListener(type, () => drop.classList.remove("is-over"));
  }
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  });
  $("#clear-files").addEventListener("click", () => {
    state.files = [];
    renderFiles();
  });

  $("#do-export").addEventListener("click", doExport);

  // reverse
  let timer = null;
  $("#set-search").addEventListener("input", (event) => {
    clearTimeout(timer);
    const value = event.target.value;
    timer = setTimeout(() => loadSets(value).catch((error) => say(error.message, "bad")), 160);
  });
  $("#set-select").addEventListener("change", (event) => pickSet(Number(event.target.value)));
  $("#do-reverse").addEventListener("click", doReverse);
  $("#do-reverse-all").addEventListener("click", doReverseAll);

  // settings
  $("#save-settings").addEventListener("click", async () => {
    try {
      await saveState(collectSettings());
      await loadState();
      applyI18n();
      say(t("web.saved"));
    } catch (error) {
      say(String(error.message || error), "bad");
    }
  });
  $("#detect-images").addEventListener("click", async () => {
    try {
      const payload = await post("/api/detect-images");
      if (!payload.path) return say(t("reverse.noImages"), "warn");
      await loadState();
      applyI18n();
      say(payload.path);
    } catch (error) {
      say(String(error.message || error), "bad");
    }
  });
  for (const button of $$("[data-browse]")) {
    button.addEventListener("click", () => openBrowser(button.dataset.browse));
  }

  // browser modal
  $("#browse-cancel").addEventListener("click", () => ($("#browser").hidden = true));
  $("#browse-up").addEventListener("click", () => browse($("#browse-up").dataset.parent));
  $("#browse-use").addEventListener("click", async () => {
    const path = $("#browse-path").dataset.path || "";
    $("#browser").hidden = true;
    if (!browseCallback) return;
    const field = browseCallback();
    if (field) field.value = path;
    if (field && field.id === "set-images") {
      await saveState({ imagesFolder: path }, { quiet: true });
      say(path);
    }
    say(path);
  });
}

/* ------------------------------------------------------------------ boot -- */
(async function main() {
  wire();
  try {
    await loadState();
    applyI18n();
    await loadSets("");
    say(t("web.connected"));
  } catch (error) {
    say(String(error.message || error), "bad");
  }
})();
