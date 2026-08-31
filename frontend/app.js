/* ============================================================
   Nett Games 2.0 — app.js
   Reads config.yaml (games, themes, announcement) and renders
   the whole site from it. No build step, no framework — just
   fast, small vanilla JS so it runs well on low-power laptops.
   ============================================================ */

(() => {
  "use strict";

  /* ---------------- constants / storage keys ---------------- */
  const LS_THEME_ID      = "ng_theme_id";      // id of selected built-in theme, or "custom"
  const LS_CUSTOM_THEME  = "ng_custom_theme";  // { mode, accent1, accent2 }
  const LS_VISITED       = "ng_visited";       // "1" once the welcome prompt has been resolved
  const LS_SOURCE_FILTER = "ng_source_filter"; // "nett" | "lumin"
  const CONFIG_URL       = "config.yaml";

  /* Column counts for the games/themes grids scale with actual screen
     width instead of a fixed number, so cards stay a readable size on
     smaller laptops/Chromebooks instead of being squeezed to fit a
     count that only makes sense on a big monitor. Tiers are checked
     top-to-bottom; the first one the current width qualifies for wins.
     Edit the numbers (or add tiers) to change the layout. */
  const GAME_GRID_COLUMNS = [
    { minWidth: 2560, cols: 8 }, // ~1440p and up
    { minWidth: 1920, cols: 7 }, // ~1080p up to 1440p
    { minWidth: 1280, cols: 6 }, // below 1080p, down to a smaller laptop
    { minWidth: 760,  cols: 5 },
    { minWidth: 420,  cols: 4 },
    { minWidth: 0,    cols: 3 },
  ];
  const THEME_GRID_COLUMNS = [
    { minWidth: 2560, cols: 5 },
    { minWidth: 1920, cols: 4 },
    { minWidth: 1280, cols: 4 },
    { minWidth: 760,  cols: 3 },
    { minWidth: 0,    cols: 2 },
  ];

  /* ---------------- tiny state ---------------- */
  const state = {
    config: null,
    sourceFilter: localStorage.getItem(LS_SOURCE_FILTER) || "nett",
    query: "",
  };

  /* LuminSDK catalog cache — populated lazily the first time the
     LuminSDK tab is opened. See loadLuminCatalog() below. */
  const lumin = {
    initPromise: null,
    games: [],       // normalized {id, title, image, category, isLumin:true}
    loaded: false,
    loading: false,
    error: null,
  };

  /* ---------------- element refs ---------------- */
  const el = {
    navBtns: document.querySelectorAll(".nav-btn"),
    pages: document.querySelectorAll(".page"),
    announcement: document.getElementById("announcement"),
    announcementText: document.getElementById("announcement-text"),
    announcementClose: document.getElementById("announcement-close"),
    sourceSwitch: document.querySelector(".source-switch"),
    switchOptions: document.querySelectorAll(".switch-option"),
    switchThumb: document.querySelector(".switch-thumb"),
    searchInput: document.getElementById("search-input"),
    gameGrid: document.getElementById("game-grid"),
    noResults: document.getElementById("no-results"),
    loadingGames: document.getElementById("loading-games"),
    themeGrid: document.getElementById("theme-grid"),
    saveBtn: document.getElementById("save-btn"),
    luminWarning: document.getElementById("lumin-warning"),
    modalOverlay: document.getElementById("modal-overlay"),
    saveModal: document.getElementById("save-modal"),
    welcomeModal: document.getElementById("welcome-modal"),
    exportBtn: document.getElementById("export-save-btn"),
    importBtn: document.getElementById("import-save-btn"),
    importFileInput: document.getElementById("import-file-input"),
    saveModalStatus: document.getElementById("save-modal-status"),
    welcomeLoadBtn: document.getElementById("welcome-load-btn"),
    welcomeSkipBtn: document.getElementById("welcome-skip-btn"),
    customModeSwitch: document.getElementById("custom-mode-switch"),
    customAccent1: document.getElementById("custom-accent-1"),
    customAccent2: document.getElementById("custom-accent-2"),
    toast: document.getElementById("toast"),
  };

  /* ============================================================
     Icons — drag-and-drop icons/ folder
     ------------------------------------------------------------
     Every icon slot in the markup is `<span class="icon-slot"
     data-icon="NAME">`. Drop a file named `icons/NAME.svg` (or
     `.png`) next to index.html and it fills in automatically — no
     HTML/CSS edits needed. Missing files just stay blank, same as
     before. See README for the full list of expected names.
     ============================================================ */
  const ICON_DIR = "icons/";
  const ICON_EXTENSIONS = ["svg", "png"];
  const ICON_KEEP_COLOR = new Set(["nett1", "nett2"]); // rendered as a plain <img>, not tinted
  const ICON_HIDE_IF_MISSING = new Set(["nett1", "nett2"]);

  function probeImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(src);
      img.onerror = () => reject();
      img.src = src;
    });
  }

  async function loadIcon(slot) {
    const name = slot.dataset.icon;
    if (!name) return;

    for (const ext of ICON_EXTENSIONS) {
      const src = `${ICON_DIR}${name}.${ext}`;
      try {
        await probeImage(src);
        if (ICON_KEEP_COLOR.has(name)) {
          const img = document.createElement("img");
          img.className = "icon-img";
          img.src = src;
          img.alt = "";
          slot.innerHTML = "";
          slot.appendChild(img);
        } else {
          slot.classList.add("icon-mask");
          slot.style.webkitMaskImage = `url("${src}")`;
          slot.style.maskImage = `url("${src}")`;
        }
        return; // found one, stop trying extensions
      } catch (e) { /* try the next extension */ }
      if (ICON_HIDE_IF_MISSING.has(name)) slot.hidden = true;
    }
    // Nothing found for this name — leave the slot blank, as before.
  }

  function loadAllIcons() {
    document.querySelectorAll("[data-icon]").forEach(loadIcon);
  }

  /* ---------------- utilities ---------------- */
  function pickColumns(tiers) {
    const w = window.innerWidth;
    for (const tier of tiers) {
      if (w >= tier.minWidth) return tier.cols;
    }
    return tiers[tiers.length - 1].cols;
  }

  function updateGridColumns() {
    const root = document.documentElement.style;
    root.setProperty("--game-cols", pickColumns(GAME_GRID_COLUMNS));
    root.setProperty("--theme-cols", pickColumns(THEME_GRID_COLUMNS));
  }

  function toast(msg, ms = 2600) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.toast.hidden = true; }, ms);
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }
  
  function compareTitles(a, b) {
    // Numeric-aware, locale-aware A→Z sort — "Level 2" sorts before
    // "Level 10", and symbols/numbers are ordered sensibly rather than
    // just by character code.
    return a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });
  }

  function dedupeByTitle() {
    // Returns a fresh filter function each call (its `seen` set needs to
    // reset per list) that drops any entry whose title — trimmed and
    // case-folded — has already been kept.
    const seen = new Set();
    return game => {
      const key = normalize(game.title);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
  }

  function normalize(str) {
    return (str || "").toString().toLowerCase().trim();
  }

  function hexToRgb(hex) {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
    const num = parseInt(full, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }

  function relativeLuminance(hex) {
    const { r, g, b } = hexToRgb(hex);
    const a = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  /* ============================================================
     Config loading
     ============================================================ */
  async function loadConfig() {
    try {
      const res = await fetch(CONFIG_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`config.yaml responded ${res.status}`);
      const text = await res.text();
      const parsed = window.jsyaml.load(text) || {};
      state.config = normalizeConfig(parsed);
    } catch (err) {
      console.error("Failed to load config.yaml:", err);
      state.config = normalizeConfig({});
      toast("Couldn't load config.yaml — check it exists and the page is served over http(s).", 5000);
    }
  }

  function normalizeConfig(cfg) {
    return {
      announcement: {
        enabled: !!(cfg.announcement && cfg.announcement.enabled && cfg.announcement.text),
        text: (cfg.announcement && cfg.announcement.text) || "",
      },
      games: Array.isArray(cfg.games) ? cfg.games.map(sanitizeGame).filter(Boolean).sort(compareTitles) : [],
      themes: Array.isArray(cfg.themes) ? cfg.themes.map(sanitizeTheme).filter(Boolean) : [],
    };
  }

  function sanitizeGame(g) {
    // Every entry in config.yaml's `games` list is a Nett game — the
    // LuminSDK catalog is fetched live and never needs to be listed here.
    if (!g || !g.title || !g.url) return null;
    return {
      title: String(g.title),
      image: typeof g.image === "string" ? g.image : "",
      url: String(g.url),
      isLumin: false,
    };
  }

  function sanitizeTheme(t) {
    if (!t || !t.name || !Array.isArray(t.accents) || t.accents.length === 0) return null;
    const accents = t.accents.filter(a => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(a));
    if (accents.length === 0) return null;
    return {
      name: String(t.name),
      mode: t.mode === "light" ? "light" : "dark",
      accents: accents.slice(0, 2),
    };
  }

  /* ============================================================
     Announcement
     ============================================================ */
  function renderAnnouncement() {
    const a = state.config.announcement;
    if (!a.enabled) {
      el.announcement.hidden = true;
      return;
    }
    el.announcementText.textContent = a.text;
    el.announcement.hidden = false;
  }

  el.announcementClose.addEventListener("click", () => {
    el.announcement.hidden = true;
  });

  /* ============================================================
     Navigation
     ============================================================ */
  el.navBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      el.navBtns.forEach(b => b.classList.toggle("active", b === btn));
      el.pages.forEach(p => p.classList.toggle("active", p.id === `page-${page}`));
    });
  });

  /* ============================================================
     Game source switch
     ============================================================ */
  function positionSwitchThumb(source) {
    const btn = el.sourceSwitch.querySelector(`[data-source="${source}"]`);
    if (!btn) return;
    el.switchThumb.style.width = `${btn.offsetWidth}px`;
    el.switchThumb.style.transform = `translateX(${btn.offsetLeft - 4}px)`;
  }

  function setSourceFilter(source) {
    state.sourceFilter = source;
    localStorage.setItem(LS_SOURCE_FILTER, source);
    el.switchOptions.forEach(b => {
      const active = b.dataset.source === source;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
    });
    positionSwitchThumb(source);
    el.luminWarning.hidden = source !== "lumin";

    if (source === "lumin" && !lumin.loaded && !lumin.loading) {
      loadLuminCatalog().then(renderGames);
    }
    renderGames();
  }

  el.switchOptions.forEach(btn => {
    btn.addEventListener("click", () => setSourceFilter(btn.dataset.source));
  });

  window.addEventListener("resize", debounce(() => {
    positionSwitchThumb(state.sourceFilter);
    updateGridColumns();
  }, 150));

  /* ============================================================
     Search
     ============================================================ */
  el.searchInput.addEventListener("input", debounce(e => {
    state.query = normalize(e.target.value);
    renderGames();
  }, 120));

  /* ============================================================
     Game grid
     ============================================================ */
  function renderGames() {
    const onLuminTab = state.sourceFilter === "lumin";

    if (onLuminTab && lumin.loading) {
      el.gameGrid.innerHTML = "";
      el.loadingGames.hidden = false;
      el.loadingGames.textContent = "Loading LuminSDK games…";
      el.noResults.hidden = true;
      return;
    }

    if (onLuminTab && lumin.error) {
      el.gameGrid.innerHTML = "";
      el.loadingGames.hidden = true;
      el.noResults.hidden = false;
      el.noResults.textContent = "Couldn't load LuminSDK's game catalog. Check your connection and reload.";
      return;
    }

    const pool = onLuminTab ? lumin.games : state.config.games;
    const filtered = pool.filter(g => {
      if (state.query && !normalize(g.title).includes(state.query)) return false;
      return true;
    });

    el.gameGrid.innerHTML = "";
    const frag = document.createDocumentFragment();

    filtered.forEach(game => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "game-card";
      card.setAttribute("aria-label", `Launch ${game.title}`);

      const img = document.createElement("img");
      img.className = "game-thumb";
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = "";
      if (game.image) img.src = game.image;

      const info = document.createElement("div");
      info.className = "game-info";

      const title = document.createElement("p");
      title.className = "game-title";
      title.textContent = game.title;

      info.appendChild(title);
      card.appendChild(img);
      card.appendChild(info);

      card.addEventListener("click", () => launchGame(game));

      frag.appendChild(card);
    });

    el.gameGrid.appendChild(frag);
    el.loadingGames.hidden = true;
    el.noResults.hidden = filtered.length !== 0;
    el.noResults.textContent = "No games match your search.";
  }

  /* ============================================================
     LuminSDK — headless catalog
     ------------------------------------------------------------
     Docs: https://docs.luminsdk.com/headless/
     The SDK script (loaded in index.html) exposes a global `Lumin`.
     `Lumin.init({ headless: true })` gives us the catalog/search/
     image/launch API without rendering Lumin's own UI, so we can
     list its games in our own grid alongside Nett's.
     ============================================================ */
  function ensureLuminInit() {
    if (!lumin.initPromise) {
      lumin.initPromise = (async () => {
        if (typeof window.Lumin === "undefined") {
          throw new Error("LuminSDK script failed to load.");
        }
        await window.Lumin.init({ headless: true });
      })();
    }
    return lumin.initPromise;
  }

  // Safety cap so a very large remote catalog can't stall the page or
  // pull down hundreds of images at once on slower hardware.
  const LUMIN_MAX_PAGES = 20;
  const LUMIN_PAGE_SIZE = 48;

  async function loadLuminCatalog() {
    lumin.loading = true;
    lumin.error = null;
    renderGames();

    try {
      await ensureLuminInit();

      let page = 1;
      let pages = 1;
      const rawGames = [];

      do {
        const res = await window.Lumin.getGames({ page, limit: LUMIN_PAGE_SIZE });
        rawGames.push(...(res.games || []));
        pages = res.pages || 1;
        page++;
      } while (page <= pages && page <= LUMIN_MAX_PAGES);

      // Page-based pagination over a catalog that can change between
      // requests can hand back the same game on two different pages
      // (everything shifts if something's added/removed mid-fetch).
      // Drop repeats by id here, before spending an API call resolving
      // an image for a game we already have.
      const seenIds = new Set();
      const uniqueRawGames = rawGames.filter(g => {
        if (seenIds.has(g.id)) return false;
        seenIds.add(g.id);
        return true;
      });

      const images = await Promise.all(
        uniqueRawGames.map(g =>
          g.image_token
            ? window.Lumin.getImageUrl(g.image_token).catch(() => "")
            : Promise.resolve("")
        )
      );

      lumin.games = uniqueRawGames.map((g, i) => ({
        id: g.id,
        title: g.name,
        image: images[i] || "",
        category: g.category || "",
        isLumin: true,
      })).filter(dedupeByTitle()).sort(compareTitles);
      lumin.loaded = true;
    } catch (err) {
      console.error("Failed to load LuminSDK catalog:", err);
      lumin.error = err;
      toast("Couldn't load LuminSDK's game catalog.", 4000);
    } finally {
      lumin.loading = false;
    }
  }

  /* ============================================================
     Game launch — opens in an about:blank-cloaked new window
     ============================================================ */
  async function launchGame(game) {
    let target = game.url;

    if (game.isLumin) {
      // Per LuminSDK's docs, getGameUrl() tokens are single-use, so this
      // has to be called fresh at launch time rather than cached.
      try {
        const { url } = await window.Lumin.getGameUrl(game.id);
        target = url;
      } catch (err) {
        console.error("Couldn't get a LuminSDK play URL:", err);
        toast("Couldn't launch that game right now.", 3200);
        return;
      }
    }

    const win = window.open("", "_blank");
    if (!win) {
      toast("Your browser blocked the pop-up — allow pop-ups for this site to launch games.", 4000);
      return;
    }

    win.document.title = game.title || "Loading…";
    win.document.body.style.margin = "0";
    win.document.body.style.background = "#000";
    win.document.body.style.height = "100vh";
    win.document.body.style.overflow = "hidden";

    const iframe = win.document.createElement("iframe");
    iframe.setAttribute("allowfullscreen", "true");
    iframe.setAttribute("allow", "fullscreen; autoplay; gamepad; pointer-lock");
    iframe.style.cssText = "border:0;width:100%;height:100vh;display:block;";
    win.document.body.appendChild(iframe);

    // Set src after append so the frame is in the DOM before it starts loading.
    iframe.src = target;

    win.focus();
    iframe.addEventListener("load", () => {
      try { iframe.contentWindow.focus(); } catch (e) { /* cross-origin, ignore */ }
      try { win.focus(); } catch (e) { /* ignore */ }
    });
  }

  /* ============================================================
     Themes
     ============================================================ */
  function applyTheme({ mode, accents }) {
    document.documentElement.classList.toggle("light-mode", mode === "light");
    document.documentElement.style.setProperty("--accent-1", accents[0]);
    document.documentElement.style.setProperty("--accent-2", accents[1] || accents[0]);
  }

  function selectBuiltinTheme(theme, idx) {
    applyTheme(theme);
    localStorage.setItem(LS_THEME_ID, String(idx));
    localStorage.removeItem(LS_CUSTOM_THEME);
    renderThemeGrid();
  }

  function selectCustomTheme(customTheme, { persist = true } = {}) {
    applyTheme({ mode: customTheme.mode, accents: [customTheme.accent1, customTheme.accent2] });
    if (persist) {
      localStorage.setItem(LS_THEME_ID, "custom");
      localStorage.setItem(LS_CUSTOM_THEME, JSON.stringify(customTheme));
    }
    renderThemeGrid();
  }

  // Card background/text previews each theme's own mode + accents,
  // independent of whatever theme is currently active on the rest of
  // the site — so a light theme's card looks light even while you're
  // browsing in dark mode, and vice versa.
  function themeCardVisual(mode, accents) {
    const isLight = mode === "light";
    // Same near-black/near-white anchors used by --bg/--bg-2 in style.css,
    // so a card's preview matches how that theme would actually render.
    const base1 = isLight ? "#f7f5fb" : "#050308";
    const base2 = isLight ? "#efe9f6" : "#0b0710";
    const a1 = accents[0];
    const a2 = accents[1] || accents[0];
    return {
      background: `linear-gradient(135deg, color-mix(in srgb, ${a1} 24%, ${base1}), color-mix(in srgb, ${a2} 16%, ${base2}))`,
      color: isLight ? "#221732" : "#f2eef8",
      swatchBorder: isLight ? "rgba(20,10,40,0.18)" : "rgba(255,255,255,0.25)",
    };
  }

  function buildThemeCard({ name, mode, accents, selected }) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "theme-card" + (selected ? " selected" : "");
    card.setAttribute("aria-pressed", String(selected));

    const visual = themeCardVisual(mode, accents);
    card.style.background = visual.background;
    card.style.color = visual.color;
    card.style.setProperty("--swatch-border", visual.swatchBorder);

    const swatchRow = document.createElement("div");
    swatchRow.className = "theme-swatch-row";
    accents.forEach(hex => {
      const sw = document.createElement("span");
      sw.className = "theme-swatch";
      sw.style.background = hex;
      swatchRow.appendChild(sw);
    });

    const meta = document.createElement("div");
    meta.className = "theme-meta";
    const nameEl = document.createElement("span");
    nameEl.className = "theme-name";
    nameEl.textContent = name;
    const modeEl = document.createElement("span");
    modeEl.className = "theme-mode";
    modeEl.textContent = mode;
    meta.appendChild(nameEl);
    meta.appendChild(modeEl);

    card.appendChild(swatchRow);
    card.appendChild(meta);
    return card;
  }

  function renderThemeGrid() {
    const themes = state.config.themes;
    const selectedId = localStorage.getItem(LS_THEME_ID);

    el.themeGrid.innerHTML = "";
    const frag = document.createDocumentFragment();

    themes.forEach((theme, idx) => {
      const card = buildThemeCard({
        name: theme.name,
        mode: theme.mode,
        accents: theme.accents,
        selected: selectedId === String(idx),
      });
      card.addEventListener("click", () => selectBuiltinTheme(theme, idx));
      frag.appendChild(card);
    });

    // "Custom" is always present as a selectable card, and always
    // previews whatever the bottom bar's controls currently hold.
    const custom = getCustomFromControls();
    const customCard = buildThemeCard({
      name: "Custom",
      mode: custom.mode,
      accents: [custom.accent1, custom.accent2],
      selected: selectedId === "custom",
    });
    customCard.addEventListener("click", () => selectCustomTheme(getCustomFromControls()));
    frag.appendChild(customCard);

    el.themeGrid.appendChild(frag);
  }

  function restoreTheme() {
    const themes = state.config.themes;
    const savedId = localStorage.getItem(LS_THEME_ID);

    const rawCustom = localStorage.getItem(LS_CUSTOM_THEME);
    if (rawCustom) {
      try { syncCustomControls(JSON.parse(rawCustom)); } catch (e) { /* ignore */ }
    }

    if (savedId === "custom" && rawCustom) {
      try {
        const custom = JSON.parse(rawCustom);
        selectCustomTheme(custom, { persist: false });
        return;
      } catch (e) { /* fall through to default */ }
    }

    if (savedId !== null && themes[Number(savedId)]) {
      applyTheme(themes[Number(savedId)]);
      renderThemeGrid();
      return;
    }

    if (themes.length > 0) {
      applyTheme(themes[0]);
      localStorage.setItem(LS_THEME_ID, "0");
    }
    renderThemeGrid();
  }

  /* ---- custom theme controls ----
     No "apply" button — any change to the mode switch or either color
     circle instantly selects and applies the custom theme. */
  function getCustomFromControls() {
    return {
      mode: el.customModeSwitch.getAttribute("aria-checked") === "true" ? "dark" : "light",
      accent1: el.customAccent1.value,
      accent2: el.customAccent2.value,
    };
  }

  function syncCustomControls(custom) {
    el.customAccent1.value = custom.accent1;
    el.customAccent2.value = custom.accent2;
    const isDark = custom.mode === "dark";
    el.customModeSwitch.setAttribute("aria-checked", String(isDark));
  }

  function applyCustomFromControls() {
    selectCustomTheme(getCustomFromControls());
  }

  el.customModeSwitch.addEventListener("click", () => {
    const isDark = el.customModeSwitch.getAttribute("aria-checked") === "true";
    el.customModeSwitch.setAttribute("aria-checked", String(!isDark));
    applyCustomFromControls();
  });

  el.customAccent1.addEventListener("input", applyCustomFromControls);
  el.customAccent2.addEventListener("input", applyCustomFromControls);

  /* ============================================================
     Save / load (localStorage export & import)
     ============================================================ */
  function openModal(modalEl) {
    el.modalOverlay.hidden = false;
    document.querySelectorAll(".modal").forEach(m => { m.hidden = m !== modalEl; });
  }
  function closeModals() {
    el.modalOverlay.hidden = true;
    document.querySelectorAll(".modal").forEach(m => { m.hidden = true; });
  }

  el.modalOverlay.addEventListener("click", e => {
    if (e.target === el.modalOverlay) closeModals();
  });
  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", closeModals);
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && !el.modalOverlay.hidden) closeModals();
  });

  el.saveBtn.addEventListener("click", () => {
    el.saveModalStatus.textContent = "";
    openModal(el.saveModal);
  });

  function exportLocalStorage() {
    const data = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      data[key] = localStorage.getItem(key);
    }
    const payload = {
      app: "nett-games",
      exportedAt: new Date().toISOString(),
      data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nett-games-save-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    el.saveModalStatus.textContent = "Save file downloaded. PUT IT IN GOOGLE DRIVE!";
  }

  function importLocalStorageFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          const data = parsed && typeof parsed === "object" && parsed.data ? parsed.data : parsed;
          if (!data || typeof data !== "object") throw new Error("Invalid save file format.");
          localStorage.clear();
          Object.keys(data).forEach(key => {
            localStorage.setItem(key, data[key]);
          });
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error("Could not read the file."));
      reader.readAsText(file);
    });
  }

  el.exportBtn.addEventListener("click", exportLocalStorage);

  el.importBtn.addEventListener("click", () => el.importFileInput.click());

  el.importFileInput.addEventListener("change", async () => {
    const file = el.importFileInput.files[0];
    el.importFileInput.value = "";
    if (!file) return;
    try {
      await importLocalStorageFromFile(file);
      el.saveModalStatus.textContent = "Save file loaded. Reloading…";
      setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      console.error(err);
      el.saveModalStatus.textContent = "Couldn't load that file — is it a Nett Games save?";
    }
  });

  /* ---- first-visit welcome prompt ---- */
  function maybeShowWelcome() {
    if (localStorage.getItem(LS_VISITED)) return;
    openModal(el.welcomeModal);
  }

  el.welcomeSkipBtn.addEventListener("click", () => {
    localStorage.setItem(LS_VISITED, "1");
    closeModals();
  });

  el.welcomeLoadBtn.addEventListener("click", () => {
    localStorage.setItem(LS_VISITED, "1");
    closeModals();
    // Reuse the same import flow as the save modal.
    el.importFileInput.onchange = null;
    el.importFileInput.click();
  });

  /* ============================================================
     Init
     ============================================================ */
  async function init() {
    positionSwitchThumb(state.sourceFilter);
    el.switchOptions.forEach(b => {
      const active = b.dataset.source === state.sourceFilter;
      b.classList.toggle("active", active);
      b.setAttribute("aria-selected", String(active));
    });
    el.luminWarning.hidden = state.sourceFilter !== "lumin";

    updateGridColumns();
    loadAllIcons();
    await loadConfig();

    renderAnnouncement();
    if (state.sourceFilter === "lumin") {
      loadLuminCatalog().then(renderGames);
    }
    renderGames();
    renderThemeGrid();
    restoreTheme();

    maybeShowWelcome();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
