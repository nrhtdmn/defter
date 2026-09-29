import * as db from "./db.js";
import { renderMarkdown, plainSnippet, wordCount, formatRelative, downloadBlob, debounce, getListInfo, nextListMarker, makeListPrefix } from "./utils.js";

const COLORS = [
  { id: null, hex: "transparent", label: "Yok" },
  { id: "moss", hex: "#2f6f5e", label: "Yosun" },
  { id: "clay", hex: "#c47a4a", label: "Kil" },
  { id: "ink", hex: "#3d5a80", label: "Mürekkep" },
  { id: "rose", hex: "#b85c6e", label: "Gül" },
  { id: "gold", hex: "#b8963e", label: "Altın" },
];

const TEMPLATES = [
  {
    title: "Günlük",
    body: `# Günlük — ${new Date().toLocaleDateString("tr-TR")}\n\n## Bugün nasıldı?\n\n\n## Minnet\n- \n\n## Yarın için\n- [ ] `,
  },
  {
    title: "Toplantı notları",
    body: `# Toplantı\n\n**Tarih:** \n**Katılımcılar:** \n\n## Gündem\n- \n\n## Kararlar\n- \n\n## Aksiyonlar\n- [ ] `,
  },
  {
    title: "Fikir",
    body: `# Fikir\n\n## Özet\n\n\n## Neden önemli?\n\n\n## Sonraki adım\n- [ ] `,
  },
  {
    title: "Alışveriş listesi",
    body: `# Alışveriş\n\n- [ ] \n- [ ] \n- [ ] `,
  },
];

const VIEW_TITLES = {
  all: "Tüm notlar",
  pinned: "Sabitlenenler",
  favorites: "Favoriler",
  archive: "Arşiv",
  trash: "Çöp kutusu",
};

const state = {
  notes: [],
  folders: [],
  view: "all",
  folderId: null,
  tag: null,
  colorFilter: null,
  query: "",
  sort: "updated",
  layout: "list",
  currentId: null,
  preview: false,
  dirty: false,
  unlocked: true,
  deferPrompt: null,
  listStyle: "paren",
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

async function init() {
  applyTheme(await db.getSetting("theme", "system"));
  applyFont(await db.getSetting("font", "md"));
  state.layout = await db.getSetting("layout", "list");
  state.sort = await db.getSetting("sort", "updated");
  state.listStyle = await db.getSetting("listStyle", "paren");
  $("#setting-theme").value = await db.getSetting("theme", "system");
  $("#setting-font").value = await db.getSetting("font", "md");
  $("#setting-layout").value = state.layout;
  $("#setting-list-style").value = state.listStyle;
  $("#setting-pin-enabled").checked = !!(await db.getSetting("pinEnabled", false));
  updateOlButtonLabel();

  await seedIfEmpty();
  await reload();

  const pinOn = await db.getSetting("pinEnabled", false);
  if (pinOn) {
    state.unlocked = false;
    showLock();
  }

  bindUI();
  registerSW();
  scheduleReminders();
  watchInstall();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", async () => {
    const t = await db.getSetting("theme", "system");
    if (t === "system") applyTheme("system");
  });

  if (new URLSearchParams(location.search).get("new") === "1") {
    history.replaceState({}, "", "./");
    createNote();
  }
}

async function seedIfEmpty() {
  const notes = await db.getAll("notes");
  if (notes.length) return;
  const folders = [
    { id: db.uid(), name: "Kişisel", createdAt: Date.now() },
    { id: db.uid(), name: "İş", createdAt: Date.now() },
  ];
  await db.bulkPut("folders", folders);
  const welcome = {
    id: db.uid(),
    title: "Defter’e hoş geldin",
    body: `# Merhaba\n\nBu senin kişisel **Defter**’in.\n\n- Markdown yazabilirsin\n- Notları sabitle, favorile, renklendir\n- Klasör ve etiket kullan\n- Çevrimdışı çalışır — veriler telefonunda kalır\n\n## Hızlı başlangıç\n- [x] Uygulamayı aç\n- [ ] İlk notunu yaz\n- [ ] Ana ekrana ekle (PWA)\n\n> İpucu: Sağ alttaki + ile yeni not aç.`,
    color: "moss",
    folderId: folders[0].id,
    tags: ["başlangıç", "rehber"],
    pinned: true,
    favorite: false,
    status: "active",
    reminderAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await db.put("notes", welcome);
}

async function reload() {
  state.notes = await db.getAll("notes");
  state.folders = await db.getAll("folders");
  renderDrawer();
  renderList();
}

function bindUI() {
  $("#btn-menu").onclick = () => openDrawer(true);
  $("#drawer-backdrop").onclick = () => openDrawer(false);
  $("#btn-new").onclick = () => showNewMenu();
  $("#btn-view-mode").onclick = toggleLayout;
  $("#btn-sort").onclick = showSortMenu;
  $("#btn-filter-color").onclick = showColorFilter;
  $("#btn-settings").onclick = () => { openDrawer(false); openSettings(true); };
  $("#btn-settings-close").onclick = () => openSettings(false);
  $("#btn-add-folder").onclick = addFolderPrompt;
  $("#btn-back").onclick = closeEditor;
  $("#btn-pin").onclick = () => toggleCurrent("pinned");
  $("#btn-fav").onclick = () => toggleCurrent("favorite");
  $("#btn-more").onclick = showNoteMore;
  $("#btn-preview").onclick = togglePreview;
  $("#btn-color").onclick = () => showColorPicker(false);
  $("#btn-folder-pick").onclick = showFolderPicker;
  $("#btn-tags").onclick = editTags;
  $("#btn-export").onclick = exportJSON;
  $("#btn-export-md").onclick = exportMarkdownZip;
  $("#btn-import").onclick = () => $("#import-file").click();
  $("#import-file").onchange = importJSON;
  $("#btn-empty-trash").onclick = emptyTrash;
  $("#btn-install").onclick = installPWA;
  $("#setting-theme").onchange = async (e) => {
    await db.setSetting("theme", e.target.value);
    applyTheme(e.target.value);
  };
  $("#setting-font").onchange = async (e) => {
    await db.setSetting("font", e.target.value);
    applyFont(e.target.value);
  };
  $("#setting-layout").onchange = async (e) => {
    state.layout = e.target.value;
    await db.setSetting("layout", state.layout);
    renderList();
  };
  $("#setting-list-style").onchange = async (e) => {
    state.listStyle = e.target.value;
    await db.setSetting("listStyle", state.listStyle);
    updateOlButtonLabel();
    toast("Madde formatı güncellendi");
  };
  $("#btn-ol").onclick = () => showListStyleMenu();
  $("#btn-indent").onclick = () => changeIndent(1);
  $("#btn-outdent").onclick = () => changeIndent(-1);
  $("#setting-pin-enabled").onchange = async (e) => {
    if (e.target.checked) {
      const pin = ($("#setting-pin").value || "").trim();
      if (!/^\d{4}$/.test(pin)) {
        e.target.checked = false;
        toast("4 haneli PIN girin");
        return;
      }
      await db.setSetting("pin", pin);
      await db.setSetting("pinEnabled", true);
      toast("PIN kilidi açıldı");
    } else {
      await db.setSetting("pinEnabled", false);
      toast("PIN kilidi kapatıldı");
    }
  };
  $("#action-backdrop").onclick = closeActions;

  $("#drawer-nav").onclick = (e) => {
    const btn = e.target.closest("[data-view]");
    if (!btn) return;
    state.view = btn.dataset.view;
    state.folderId = null;
    state.tag = null;
    openDrawer(false);
    renderDrawer();
    renderList();
  };

  const search = debounce((q) => {
    state.query = q;
    renderList();
  }, 180);
  $("#search-input").oninput = (e) => search(e.target.value.trim().toLowerCase());

  const saveSoon = debounce(saveCurrent, 400);
  $("#note-title").oninput = () => { state.dirty = true; $("#save-status").textContent = "Kaydediliyor…"; saveSoon(); updateStats(); };
  $("#note-body").oninput = () => { state.dirty = true; $("#save-status").textContent = "Kaydediliyor…"; saveSoon(); updateStats(); if (state.preview) refreshPreview(); };
  $("#reminder-input").onchange = async (e) => {
    const note = getCurrent();
    if (!note) return;
    note.reminderAt = e.target.value ? new Date(e.target.value).getTime() : null;
    note.updatedAt = Date.now();
    await db.put("notes", note);
    if (note.reminderAt && "Notification" in window && Notification.permission === "default") {
      await Notification.requestPermission();
    }
    toast(note.reminderAt ? "Hatırlatıcı ayarlandı" : "Hatırlatıcı kaldırıldı");
    scheduleReminders();
  };

  $$("#editor-toolbar [data-md]").forEach((btn) => {
    btn.onclick = () => applyMd(btn.dataset.md);
  });

  const body = $("#note-body");
  body.addEventListener("keydown", onEditorKeydown);

  // Swipe back on editor (simple)
  let touchX = null;
  $("#editor").addEventListener("touchstart", (e) => { touchX = e.changedTouches[0].screenX; }, { passive: true });
  $("#editor").addEventListener("touchend", (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].screenX - touchX;
    if (dx > 80 && e.changedTouches[0].screenX < 80) closeEditor();
    touchX = null;
  }, { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveCurrent();
  });
  window.addEventListener("beforeunload", () => { if (state.dirty) saveCurrent(); });
}

function openDrawer(open) {
  $("#drawer").classList.toggle("open", open);
  $("#drawer-backdrop").hidden = !open;
}

function openSettings(open) {
  $("#settings").classList.toggle("hidden", !open);
}

function applyTheme(mode) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const meta = document.querySelector('meta[name="theme-color"]:not([media]), meta[name="theme-color"]');
  // update both if present
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (!m.media || (dark && m.media.includes("dark")) || (!dark && m.media.includes("light"))) {
      m.content = dark ? "#121916" : "#f3efe6";
    }
  });
}

function applyFont(size) {
  document.documentElement.dataset.font = size;
}

function renderDrawer() {
  const active = filterNotes("active");
  $("#count-all").textContent = active.length;
  $("#count-pinned").textContent = active.filter((n) => n.pinned).length;
  $("#count-fav").textContent = active.filter((n) => n.favorite).length;
  $("#count-archive").textContent = filterNotes("archive").length;
  $("#count-trash").textContent = filterNotes("trash").length;

  $$("#drawer-nav .nav-item").forEach((b) => {
    b.classList.toggle("active", !state.folderId && !state.tag && b.dataset.view === state.view);
  });

  const fl = $("#folder-list");
  fl.innerHTML = "";
  state.folders
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, "tr"))
    .forEach((f) => {
      const count = active.filter((n) => n.folderId === f.id).length;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `nav-item${state.folderId === f.id ? " active" : ""}`;
      btn.innerHTML = `<span class="nav-ico">▸</span> ${escape(f.name)} <em>${count}</em>`;
      btn.onclick = () => {
        state.folderId = f.id;
        state.view = "all";
        state.tag = null;
        openDrawer(false);
        renderDrawer();
        renderList();
      };
      btn.oncontextmenu = (e) => {
        e.preventDefault();
        folderMenu(f);
      };
      let t;
      btn.addEventListener("touchstart", () => { t = setTimeout(() => folderMenu(f), 500); }, { passive: true });
      btn.addEventListener("touchend", () => clearTimeout(t));
      fl.appendChild(btn);
    });

  const tags = new Map();
  active.forEach((n) => (n.tags || []).forEach((t) => tags.set(t, (tags.get(t) || 0) + 1)));
  const cloud = $("#tag-cloud");
  cloud.innerHTML = "";
  [...tags.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr"))
    .slice(0, 24)
    .forEach(([tag, c]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `tag-pill${state.tag === tag ? " active" : ""}`;
      b.textContent = `#${tag} ${c}`;
      b.onclick = () => {
        state.tag = state.tag === tag ? null : tag;
        state.folderId = null;
        openDrawer(false);
        renderDrawer();
        renderList();
      };
      cloud.appendChild(b);
    });
}

function filterNotes(status) {
  return state.notes.filter((n) => n.status === status);
}

function visibleNotes() {
  let list;
  if (state.view === "archive") list = filterNotes("archive");
  else if (state.view === "trash") list = filterNotes("trash");
  else {
    list = filterNotes("active");
    if (state.view === "pinned") list = list.filter((n) => n.pinned);
    if (state.view === "favorites") list = list.filter((n) => n.favorite);
  }
  if (state.folderId) list = list.filter((n) => n.folderId === state.folderId);
  if (state.tag) list = list.filter((n) => (n.tags || []).includes(state.tag));
  if (state.colorFilter) list = list.filter((n) => n.color === state.colorFilter);
  if (state.query) {
    const q = state.query;
    list = list.filter((n) =>
      (n.title || "").toLowerCase().includes(q) ||
      (n.body || "").toLowerCase().includes(q) ||
      (n.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }

  list = list.slice().sort((a, b) => {
    if (state.view === "all" && !state.query) {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    }
    if (state.sort === "title") return (a.title || "").localeCompare(b.title || "", "tr");
    if (state.sort === "created") return b.createdAt - a.createdAt;
    return b.updatedAt - a.updatedAt;
  });
  return list;
}

function renderList() {
  const list = visibleNotes();
  const folder = state.folders.find((f) => f.id === state.folderId);
  let title = VIEW_TITLES[state.view] || "Notlar";
  if (folder) title = folder.name;
  if (state.tag) title = `#${state.tag}`;
  $("#view-title").textContent = title;
  $("#view-sub").textContent = `${list.length} not`;

  const el = $("#notes-list");
  el.classList.toggle("grid", state.layout === "grid");
  $("#btn-view-mode").textContent = state.layout === "grid" ? "☰" : "▦";

  el.innerHTML = "";
  if (!list.length) {
    $("#empty-state").classList.remove("hidden");
    const emptyMap = {
      trash: ["Çöp boş", "Silinen notlar burada görünür."],
      archive: ["Arşiv boş", "Arşivlediğin notlar burada."],
      pinned: ["Sabitlenmiş not yok", "Önemli notları sabitle."],
      favorites: ["Favori yok", "Yıldızlayarak favorilere ekle."],
    };
    const [t, s] = emptyMap[state.view] || ["Henüz not yok", "İlk notunu yazmaya başla — fikirler burada büyüsün."];
    $("#empty-title").textContent = state.query ? "Sonuç yok" : t;
    $("#empty-text").textContent = state.query ? "Başka bir arama dene." : s;
    return;
  }
  $("#empty-state").classList.add("hidden");

  list.forEach((n, i) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "note-card";
    card.style.setProperty("--card-color", colorHex(n.color));
    card.style.animationDelay = `${Math.min(i, 12) * 20}ms`;
    card.setAttribute("role", "listitem");
    const badges = [];
    if (n.pinned) badges.push('<span class="badge" title="Sabit">◎</span>');
    if (n.favorite) badges.push('<span class="badge" title="Favori">★</span>');
    if (n.reminderAt) badges.push('<span class="badge" title="Hatırlatıcı">⏰</span>');
    card.innerHTML = `
      <div class="title">${escape(n.title || "Başlıksız")}</div>
      <div class="snippet">${escape(plainSnippet(n.body))}</div>
      <div class="meta">
        <span>${formatRelative(n.updatedAt)}</span>
        ${(n.tags || []).slice(0, 2).map((t) => `#${escape(t)}`).join(" ")}
        <span class="badges">${badges.join("")}</span>
      </div>`;
    card.onclick = () => openEditor(n.id);
    el.appendChild(card);
  });
}

function colorHex(id) {
  return COLORS.find((c) => c.id === id)?.hex || "transparent";
}

function escape(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function createNote(partial = {}) {
  const note = {
    id: db.uid(),
    title: "",
    body: "",
    color: null,
    folderId: state.folderId,
    tags: [],
    pinned: false,
    favorite: false,
    status: "active",
    reminderAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...partial,
  };
  await db.put("notes", note);
  state.notes.push(note);
  openEditor(note.id);
  renderDrawer();
}

function showNewMenu() {
  openActions("Yeni not", [
    { label: "Boş not", action: () => createNote() },
    ...TEMPLATES.map((t) => ({
      label: `Şablon: ${t.title}`,
      action: () => createNote({ title: t.title, body: t.body }),
    })),
  ]);
}

function getCurrent() {
  return state.notes.find((n) => n.id === state.currentId) || null;
}

function openEditor(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  state.currentId = id;
  state.preview = false;
  state.dirty = false;
  $("#editor").classList.remove("hidden");
  $("#note-title").value = note.title || "";
  $("#note-body").value = note.body || "";
  $("#note-preview").classList.add("hidden");
  $("#note-body").classList.remove("hidden");
  $("#btn-preview").classList.remove("active");
  $("#btn-pin").classList.toggle("active", !!note.pinned);
  $("#btn-fav").classList.toggle("active", !!note.favorite);
  $("#btn-color").style.color = colorHex(note.color) === "transparent" ? "var(--accent)" : colorHex(note.color);
  const folder = state.folders.find((f) => f.id === note.folderId);
  $("#btn-folder-pick").textContent = folder ? folder.name : "Klasör";
  renderNoteTags(note);
  if (note.reminderAt) {
    const d = new Date(note.reminderAt);
    const pad = (n) => String(n).padStart(2, "0");
    $("#reminder-input").value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else {
    $("#reminder-input").value = "";
  }
  $("#save-status").textContent = "Kaydedildi";
  updateStats();
  setTimeout(() => {
    if (!note.title && !note.body) $("#note-title").focus();
  }, 50);
}

async function closeEditor() {
  await saveCurrent();
  $("#editor").classList.add("hidden");
  state.currentId = null;
  renderList();
  renderDrawer();
}

async function saveCurrent() {
  const note = getCurrent();
  if (!note) return;
  note.title = $("#note-title").value;
  note.body = $("#note-body").value;
  note.updatedAt = Date.now();
  await db.put("notes", note);
  state.dirty = false;
  $("#save-status").textContent = "Kaydedildi";
}

function updateStats() {
  const { words, chars } = wordCount($("#note-body").value);
  $("#note-stats").textContent = `${words} kelime · ${chars} karakter`;
}

function renderNoteTags(note) {
  const row = $("#note-tags-row");
  row.innerHTML = (note.tags || [])
    .map((t) => `<span class="tag-pill">${escape("#" + t)}</span>`)
    .join("");
}

async function toggleCurrent(field) {
  const note = getCurrent();
  if (!note) return;
  note[field] = !note[field];
  note.updatedAt = Date.now();
  await db.put("notes", note);
  $("#btn-pin").classList.toggle("active", !!note.pinned);
  $("#btn-fav").classList.toggle("active", !!note.favorite);
  toast(field === "pinned" ? (note.pinned ? "Sabitlendi" : "Sabit kaldırıldı") : (note.favorite ? "Favorilere eklendi" : "Favorilerden çıkarıldı"));
}

function togglePreview() {
  state.preview = !state.preview;
  $("#btn-preview").classList.toggle("active", state.preview);
  $("#note-body").classList.toggle("hidden", state.preview);
  $("#note-preview").classList.toggle("hidden", !state.preview);
  if (state.preview) refreshPreview();
}

function refreshPreview() {
  $("#note-preview").innerHTML = renderMarkdown($("#note-body").value);
}

function updateOlButtonLabel() {
  const btn = $("#btn-ol");
  if (!btn) return;
  if (state.listStyle === "dot") btn.textContent = "1.";
  else if (state.listStyle === "alpha") btn.textContent = "a)";
  else btn.textContent = "1)";
}

function showListStyleMenu() {
  openActions("Madde formatı", [
    {
      label: "1) 2) 3)  — numaralı",
      action: async () => {
        state.listStyle = "paren";
        await db.setSetting("listStyle", "paren");
        $("#setting-list-style").value = "paren";
        updateOlButtonLabel();
        insertListBlock("paren");
      },
    },
    {
      label: "1. 2. 3.  — numaralı",
      action: async () => {
        state.listStyle = "dot";
        await db.setSetting("listStyle", "dot");
        $("#setting-list-style").value = "dot";
        updateOlButtonLabel();
        insertListBlock("dot");
      },
    },
    {
      label: "a) b) c)  — harfli",
      action: async () => {
        state.listStyle = "alpha";
        await db.setSetting("listStyle", "alpha");
        $("#setting-list-style").value = "alpha";
        updateOlButtonLabel();
        insertListBlock("alpha");
      },
    },
    {
      label: "Seçili satırları numaralandır",
      action: () => numberSelectedLines(state.listStyle),
    },
  ]);
}

function getLineBounds(text, pos) {
  const start = text.lastIndexOf("\n", pos - 1) + 1;
  let end = text.indexOf("\n", pos);
  if (end < 0) end = text.length;
  return { start, end, line: text.slice(start, end) };
}

function markDirty() {
  state.dirty = true;
  $("#save-status").textContent = "Kaydediliyor…";
  debounce(saveCurrent, 400)();
  updateStats();
}

function insertListBlock(style) {
  const ta = $("#note-body");
  const val = ta.value;
  const { start, end, line } = getLineBounds(val, ta.selectionStart);
  const info = getListInfo(line);
  const prefix = makeListPrefix(style, 1, info ? info.indent : "");
  let next;
  let cursor;

  if (info && !info.body.trim()) {
    // replace empty marker
    next = val.slice(0, start) + prefix + val.slice(end);
    cursor = start + prefix.length;
  } else if (info) {
    // convert existing list line marker
    next = val.slice(0, start) + prefix + info.body + val.slice(end);
    cursor = start + prefix.length + info.body.length;
  } else if (line.trim() === "") {
    next = val.slice(0, start) + prefix + val.slice(end);
    cursor = start + prefix.length;
  } else {
    next = val.slice(0, start) + prefix + line + val.slice(end);
    cursor = start + prefix.length + line.length;
  }

  ta.value = next;
  ta.focus();
  ta.setSelectionRange(cursor, cursor);
  markDirty();
}

function numberSelectedLines(style) {
  const ta = $("#note-body");
  const val = ta.value;
  let from = ta.selectionStart;
  let to = ta.selectionEnd;
  if (from === to) {
    insertListBlock(style);
    return;
  }
  // expand to full lines
  from = val.lastIndexOf("\n", from - 1) + 1;
  let end = val.indexOf("\n", to - 1);
  if (end < 0) end = val.length;
  else if (to > 0 && val[to - 1] === "\n") end = to - 1;

  const block = val.slice(from, end);
  const lines = block.split("\n");
  let n = 1;
  const converted = lines.map((ln) => {
    if (!ln.trim()) return ln;
    const info = getListInfo(ln);
    const body = info ? info.body : ln.replace(/^[ \t]+/, "");
    const indent = info ? info.indent : (ln.match(/^[ \t]*/)?.[0] || "");
    const prefix = makeListPrefix(style, n++, indent);
    return prefix + body;
  });
  ta.value = val.slice(0, from) + converted.join("\n") + val.slice(end);
  ta.focus();
  markDirty();
}

function changeIndent(dir) {
  const ta = $("#note-body");
  const val = ta.value;
  const { start, end, line } = getLineBounds(val, ta.selectionStart);
  const info = getListInfo(line);
  let newLine;
  if (info) {
    let indent = info.indent;
    if (dir > 0) indent += "  ";
    else indent = indent.slice(2);
    const marker =
      info.kind === "check" ? `- [${info.raw.match(/- \[([ xX])\]/)?.[1] || " "}] `
        : info.kind === "ul" ? "- "
          : info.kind === "alpha" ? `${info.letter}${info.sep} `
            : `${info.num}${info.sep} `;
    newLine = indent + marker + info.body;
  } else if (dir > 0) {
    newLine = `  ${line}`;
  } else {
    newLine = line.replace(/^(\t|  )/, "");
  }
  ta.value = val.slice(0, start) + newLine + val.slice(end);
  const cursor = start + newLine.length;
  ta.focus();
  ta.setSelectionRange(cursor, cursor);
  markDirty();
}

function onEditorKeydown(e) {
  const ta = e.target;
  if (e.key === "Tab") {
    e.preventDefault();
    changeIndent(e.shiftKey ? -1 : 1);
    return;
  }
  if (e.key !== "Enter" || e.shiftKey) return;

  const val = ta.value;
  const pos = ta.selectionStart;
  if (ta.selectionStart !== ta.selectionEnd) return;
  const { start, end, line } = getLineBounds(val, pos);
  const info = getListInfo(line);
  if (!info) return;
  if (pos < start || pos > end) return;

  e.preventDefault();

  // Empty item: outdent one level, or leave the list
  if (!info.body.trim()) {
    if (info.level > 0) {
      const indent = info.indent.slice(2);
      const marker =
        info.kind === "check" ? "- [ ] "
          : info.kind === "ul" ? "- "
            : info.kind === "alpha" ? `${info.letter}${info.sep} `
              : `${info.num}${info.sep} `;
      const newLine = indent + marker;
      ta.value = val.slice(0, start) + newLine + val.slice(end);
      ta.setSelectionRange(start + newLine.length, start + newLine.length);
    } else {
      ta.value = val.slice(0, start) + val.slice(end);
      ta.setSelectionRange(start, start);
    }
    markDirty();
    return;
  }

  const nextMarker = nextListMarker(info, state.listStyle);
  ta.value = `${val.slice(0, pos)}\n${nextMarker}${val.slice(pos)}`;
  const cursor = pos + 1 + nextMarker.length;
  ta.setSelectionRange(cursor, cursor);
  markDirty();
}

function applyMd(type) {
  const ta = $("#note-body");
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const val = ta.value;
  const sel = val.slice(start, end);

  if (type === "ul") {
    if (start !== end && sel.includes("\n")) {
      numberSelectedLines("ul");
      return;
    }
    insertListBlock("ul");
    return;
  }
  if (type === "check") {
    insertListBlock("check");
    return;
  }

  const wrap = {
    bold: [`**${sel || "kalın"}**`, sel ? 0 : 2],
    italic: [`*${sel || "italik"}*`, sel ? 0 : 1],
    h2: [`## ${sel || "Başlık"}`, 0],
    quote: [`> ${sel || "alıntı"}`, 0],
    code: sel.includes("\n") ? [`\`\`\`\n${sel || "kod"}\n\`\`\``, 0] : [`\`${sel || "kod"}\``, sel ? 0 : 1],
  };
  const item = wrap[type];
  if (!item) return;
  const [insert] = item;
  ta.value = val.slice(0, start) + insert + val.slice(end);
  ta.focus();
  markDirty();
}

function showNoteMore() {
  const note = getCurrent();
  if (!note) return;
  const items = [];
  if (note.status === "active") {
    items.push({ label: "Arşivle", action: () => setStatus("archive") });
    items.push({ label: "Çöp kutusuna taşı", danger: true, action: () => setStatus("trash") });
  } else if (note.status === "archive") {
    items.push({ label: "Arşivden çıkar", action: () => setStatus("active") });
    items.push({ label: "Çöp kutusuna taşı", danger: true, action: () => setStatus("trash") });
  } else {
    items.push({ label: "Geri yükle", action: () => setStatus("active") });
    items.push({ label: "Kalıcı sil", danger: true, action: () => hardDelete() });
  }
  items.push({ label: "Kopyala", action: duplicateCurrent });
  items.push({ label: "Paylaş", action: shareCurrent });
  items.push({ label: "Markdown olarak indir", action: downloadCurrentMd });
  openActions("Not işlemleri", items);
}

async function setStatus(status) {
  const note = getCurrent();
  if (!note) return;
  note.status = status;
  note.updatedAt = Date.now();
  await db.put("notes", note);
  toast(status === "archive" ? "Arşivlendi" : status === "trash" ? "Çöpe taşındı" : "Geri yüklendi");
  await closeEditor();
}

async function hardDelete() {
  const note = getCurrent();
  if (!note) return;
  await db.remove("notes", note.id);
  state.notes = state.notes.filter((n) => n.id !== note.id);
  toast("Silindi");
  $("#editor").classList.add("hidden");
  state.currentId = null;
  renderList();
  renderDrawer();
}

async function duplicateCurrent() {
  const note = getCurrent();
  if (!note) return;
  await saveCurrent();
  await createNote({
    title: `${note.title || "Başlıksız"} (kopya)`,
    body: note.body,
    color: note.color,
    folderId: note.folderId,
    tags: [...(note.tags || [])],
  });
  toast("Kopyalandı");
}

async function shareCurrent() {
  await saveCurrent();
  const note = getCurrent();
  if (!note) return;
  const text = `${note.title || "Başlıksız"}\n\n${note.body}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: note.title || "Defter notu", text });
      return;
    } catch {}
  }
  await navigator.clipboard.writeText(text);
  toast("Panoya kopyalandı");
}

async function downloadCurrentMd() {
  await saveCurrent();
  const note = getCurrent();
  if (!note) return;
  const name = `${(note.title || "not").replace(/[^\w\u00C0-\u024fığüşöçİĞÜŞÖÇ\s-]/gi, "").trim() || "not"}.md`;
  downloadBlob(name, new Blob([`# ${note.title || "Başlıksız"}\n\n${note.body}`], { type: "text/markdown" }));
}

function showColorPicker(isFilter) {
  const note = getCurrent();
  const panel = `
    <h3>${isFilter ? "Renk filtresi" : "Not rengi"}</h3>
    <div class="color-grid">
      ${COLORS.map((c) => `
        <button type="button" class="color-swatch${(!isFilter && note?.color === c.id) || (isFilter && state.colorFilter === c.id) ? " active" : ""}"
          data-color="${c.id ?? ""}" style="background:${c.hex === "transparent" ? "var(--bg-soft)" : c.hex}" title="${c.label}"></button>
      `).join("")}
    </div>`;
  openActionsRaw(panel, (root) => {
    root.querySelectorAll(".color-swatch").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.dataset.color || null;
        if (isFilter) {
          state.colorFilter = id;
          closeActions();
          renderList();
          toast(id ? "Renk filtresi uygulandı" : "Filtre temizlendi");
          return;
        }
        const n = getCurrent();
        if (!n) return;
        n.color = id;
        n.updatedAt = Date.now();
        await db.put("notes", n);
        $("#btn-color").style.color = colorHex(id) === "transparent" ? "var(--accent)" : colorHex(id);
        closeActions();
        toast("Renk güncellendi");
      };
    });
  });
}

function showColorFilter() {
  showColorPicker(true);
}

function showFolderPicker() {
  const note = getCurrent();
  if (!note) return;
  openActions("Klasör seç", [
    { label: "Klasörsüz", action: async () => { note.folderId = null; note.updatedAt = Date.now(); await db.put("notes", note); $("#btn-folder-pick").textContent = "Klasör"; toast("Klasör kaldırıldı"); } },
    ...state.folders.map((f) => ({
      label: f.name,
      action: async () => {
        note.folderId = f.id;
        note.updatedAt = Date.now();
        await db.put("notes", note);
        $("#btn-folder-pick").textContent = f.name;
        toast("Klasöre taşındı");
      },
    })),
  ]);
}

function editTags() {
  const note = getCurrent();
  if (!note) return;
  openActionsRaw(`
    <h3>Etiketler</h3>
    <p class="muted" style="margin:0 12px 8px;font-size:0.85rem">Virgülle ayırın</p>
    <input class="prompt-field" id="tag-input" value="${escape((note.tags || []).join(", "))}" placeholder="iş, fikir, acil" />
    <button type="button" class="action-item" id="tag-save">Kaydet</button>
  `, (root) => {
    const input = root.querySelector("#tag-input");
    input.focus();
    root.querySelector("#tag-save").onclick = async () => {
      note.tags = input.value
        .split(",")
        .map((t) => t.trim().replace(/^#/, "").toLowerCase())
        .filter(Boolean)
        .slice(0, 12);
      note.updatedAt = Date.now();
      await db.put("notes", note);
      renderNoteTags(note);
      closeActions();
      toast("Etiketler güncellendi");
    };
  });
}

async function addFolderPrompt() {
  openActionsRaw(`
    <h3>Yeni klasör</h3>
    <input class="prompt-field" id="folder-input" placeholder="Klasör adı" maxlength="40" />
    <button type="button" class="action-item" id="folder-save">Oluştur</button>
  `, (root) => {
    const input = root.querySelector("#folder-input");
    input.focus();
    root.querySelector("#folder-save").onclick = async () => {
      const name = input.value.trim();
      if (!name) return;
      const folder = { id: db.uid(), name, createdAt: Date.now() };
      await db.put("folders", folder);
      state.folders.push(folder);
      closeActions();
      renderDrawer();
      toast("Klasör eklendi");
    };
  });
}

function folderMenu(folder) {
  openActions(folder.name, [
    {
      label: "Yeniden adlandır",
      action: () => {
        openActionsRaw(`
          <h3>Yeniden adlandır</h3>
          <input class="prompt-field" id="rename-input" value="${escape(folder.name)}" maxlength="40" />
          <button type="button" class="action-item" id="rename-save">Kaydet</button>
        `, (root) => {
          const input = root.querySelector("#rename-input");
          input.focus();
          root.querySelector("#rename-save").onclick = async () => {
            folder.name = input.value.trim() || folder.name;
            await db.put("folders", folder);
            closeActions();
            renderDrawer();
            renderList();
          };
        });
      },
    },
    {
      label: "Klasörü sil",
      danger: true,
      action: async () => {
        await db.remove("folders", folder.id);
        state.folders = state.folders.filter((f) => f.id !== folder.id);
        for (const n of state.notes) {
          if (n.folderId === folder.id) {
            n.folderId = null;
            await db.put("notes", n);
          }
        }
        if (state.folderId === folder.id) state.folderId = null;
        renderDrawer();
        renderList();
        toast("Klasör silindi");
      },
    },
  ]);
}

function showSortMenu() {
  openActions("Sıralama", [
    { label: "Son güncellenen", action: async () => { state.sort = "updated"; await db.setSetting("sort", state.sort); renderList(); } },
    { label: "Oluşturulma tarihi", action: async () => { state.sort = "created"; await db.setSetting("sort", state.sort); renderList(); } },
    { label: "Başlık (A–Z)", action: async () => { state.sort = "title"; await db.setSetting("sort", state.sort); renderList(); } },
  ]);
}

async function toggleLayout() {
  state.layout = state.layout === "list" ? "grid" : "list";
  await db.setSetting("layout", state.layout);
  renderList();
}

function openActions(title, items) {
  openActionsRaw(`
    <h3>${escape(title)}</h3>
    ${items.map((it, i) => `<button type="button" class="action-item${it.danger ? " danger" : ""}" data-i="${i}">${escape(it.label)}</button>`).join("")}
  `, (root) => {
    root.querySelectorAll("[data-i]").forEach((btn) => {
      btn.onclick = async () => {
        closeActions();
        await items[+btn.dataset.i].action();
      };
    });
  });
}

function openActionsRaw(html, bind) {
  const sheet = $("#action-sheet");
  const panel = $("#action-panel");
  panel.innerHTML = html;
  sheet.classList.remove("hidden");
  bind?.(panel);
}

function closeActions() {
  $("#action-sheet").classList.add("hidden");
  $("#action-panel").innerHTML = "";
}

async function exportJSON() {
  const payload = {
    app: "Defter",
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: await db.getAll("notes"),
    folders: await db.getAll("folders"),
  };
  downloadBlob(`defter-yedek-${dateStamp()}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  toast("Dışa aktarıldı");
}

async function exportMarkdownZip() {
  // Without a zip lib: export a single concatenated markdown file
  const notes = (await db.getAll("notes")).filter((n) => n.status !== "trash");
  const md = notes
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((n) => `# ${n.title || "Başlıksız"}\n\n${n.body}\n\n---\n`)
    .join("\n");
  downloadBlob(`defter-notlar-${dateStamp()}.md`, new Blob([md], { type: "text/markdown" }));
  toast("Markdown indirildi");
}

async function importJSON(e) {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!data.notes || !Array.isArray(data.notes)) throw new Error("Geçersiz dosya");
    if (Array.isArray(data.folders)) {
      for (const f of data.folders) await db.put("folders", f);
    }
    for (const n of data.notes) {
      if (!n.id) n.id = db.uid();
      await db.put("notes", n);
    }
    await reload();
    toast(`${data.notes.length} not içe aktarıldı`);
  } catch {
    toast("İçe aktarma başarısız");
  }
}

async function emptyTrash() {
  const trash = state.notes.filter((n) => n.status === "trash");
  for (const n of trash) await db.remove("notes", n.id);
  state.notes = state.notes.filter((n) => n.status !== "trash");
  renderDrawer();
  renderList();
  toast("Çöp boşaltıldı");
}

function dateStamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2200);
}

/* PIN lock */
function showLock() {
  $("#lock-screen").classList.remove("hidden");
  $("#lock-screen").setAttribute("aria-hidden", "false");
  let entered = "";
  const dots = $("#pin-dots");
  const pad = $("#pin-pad");
  dots.innerHTML = "<span></span><span></span><span></span><span></span>";
  pad.innerHTML = "";
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  keys.forEach((k) => {
    const b = document.createElement("button");
    b.type = "button";
    if (!k) { b.style.visibility = "hidden"; pad.appendChild(b); return; }
    b.textContent = k;
    b.onclick = async () => {
      if (k === "⌫") {
        entered = entered.slice(0, -1);
      } else if (entered.length < 4) {
        entered += k;
      }
      [...dots.children].forEach((d, i) => d.classList.toggle("filled", i < entered.length));
      if (entered.length === 4) {
        const pin = await db.getSetting("pin", "");
        if (entered === pin) {
          state.unlocked = true;
          $("#lock-screen").classList.add("hidden");
          $("#lock-screen").setAttribute("aria-hidden", "true");
        } else {
          toast("Yanlış PIN");
          entered = "";
          [...dots.children].forEach((d) => d.classList.remove("filled"));
        }
      }
    };
    pad.appendChild(b);
  });
  $("#pin-forgot").onclick = async () => {
    if (confirm("PIN sıfırlansın mı? (Kilidi kapatır)")) {
      await db.setSetting("pinEnabled", false);
      await db.setSetting("pin", "");
      state.unlocked = true;
      $("#lock-screen").classList.add("hidden");
      $("#setting-pin-enabled").checked = false;
      toast("PIN sıfırlandı");
    }
  };
}

/* Reminders */
function scheduleReminders() {
  if (!("Notification" in window)) return;
  const due = state.notes.filter((n) => n.status === "active" && n.reminderAt && n.reminderAt > Date.now());
  due.forEach((n) => {
    const delay = n.reminderAt - Date.now();
    if (delay > 2147483647) return;
    clearTimeout(n._timer);
    n._timer = setTimeout(async () => {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") {
        new Notification(n.title || "Defter hatırlatıcı", { body: plainSnippet(n.body, 80), icon: "./icons/icon.svg" });
      } else {
        toast(`Hatırlatıcı: ${n.title || "Başlıksız"}`);
      }
    }, delay);
  });
}

/* PWA */
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

function watchInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    state.deferPrompt = e;
    $("#btn-install").hidden = false;
  });
}

async function installPWA() {
  if (!state.deferPrompt) {
    toast("Tarayıcı menüsünden ‘Ana ekrana ekle’yi kullanın");
    return;
  }
  state.deferPrompt.prompt();
  await state.deferPrompt.userChoice;
  state.deferPrompt = null;
  $("#btn-install").hidden = true;
}

init().catch((err) => {
  console.error(err);
  toast("Uygulama yüklenemedi");
});
