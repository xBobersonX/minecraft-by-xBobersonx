const $ = id => document.getElementById(id);

let settings;

function log(text) {
  const el = $("log");
  el.textContent += text.endsWith("\n") ? text : text + "\n";
  el.scrollTop = el.scrollHeight;
}

function setStatus(text, percent) {
  $("status").textContent = text;
  if (percent !== undefined) {
    document.querySelector(".progress").hidden = false;
    $("bar").style.width = `${percent}%`;
  }
}

function persist() {
  // przy koncie Microsoft pole pokazuje nazwę konta — zapisany zostaje nick non-premium
  if (!$("nick").disabled) settings.nick = $("nick").value.trim();
  settings.version = $("version").value;
  settings.ram = Number($("ram").value);
  settings.window = {
    fullscreen: $("win-fullscreen").checked,
    width: Number($("win-width").value) || 1280,
    height: Number($("win-height").value) || 720,
  };
  settings.afterLaunch = $("after-launch").value;
  settings.javaArgs = $("java-args").value.trim();
  settings.syncOptions = $("sync-options").checked;
  window.api.saveSettings(settings);
}

// Najpierw zainstalowane modpacki, potem paczka xBobersonx dla każdej wersji obsługiwanej przez Fabric
// i wersje na Forge z własną paczką (forgeVersions: { "1.8.9": "xBobersonx PvP" }).
// Wersje z forgeModern (1.20+) mają dodatkowo wpis z paczką na nowym Forge.
// onlyInstalled: bez internetu pokazujemy tylko wersje, które już są pobrane
// Co jest dostępne dla każdej wersji gry — okno „Nowy profil” pokazuje tylko działające loadery
let loaderSets = { versions: [], fabric: new Set(), oldForge: {}, forge: new Set(), neoforge: new Set(), packName: "" };
// slug → dane modpacka albo profilu (np. czy profil ma paczkę xBobersonx)
const instanceInfo = new Map();

const LOADER_NAMES = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge", vanilla: "bez modów" };

// Polecane wersje z modem Bobr Config. Reszta jest schowana pod „Pokaż wszystkie wersje”
const FEATURED_VERSIONS = ["1.8.9", "1.21.11"];
const TOGGLE_VERSIONS = "__wersje";
let versionArgs = null; // ostatnie dane listy, żeby ją przerysować po przełączeniu
let shownVersion = "";  // ostatnio wybrana pozycja

function fillVersions(versions, fabricVersions, packName, onlyInstalled, modpacks = [], forgeVersions = {}, forgeModern = new Set(), neoforge = new Set()) {
  versionArgs = [versions, fabricVersions, packName, onlyInstalled, modpacks, forgeVersions, forgeModern, neoforge];
  loaderSets = { versions, fabric: fabricVersions, oldForge: forgeVersions, forge: forgeModern, neoforge, packName };
  instanceInfo.clear();
  const select = $("version");
  select.innerHTML = "";
  // najpierw własne profile, potem modpacki
  const sorted = [...modpacks.filter(m => m.kind === "profile"), ...modpacks.filter(m => m.kind !== "profile")];
  for (const mp of sorted) {
    instanceInfo.set(mp.slug, mp);
    const opt = document.createElement("option");
    opt.value = `${mp.gameVersion}|mp:${mp.slug}`;
    if (mp.kind === "profile") {
      opt.textContent = `🧩 ${mp.title} (${mp.gameVersion}, ${mp.loader === "vanilla" ? "bez modów" : LOADER_NAMES[mp.loader]})`;
    } else {
      const mpLoader = { forge: ", Forge", neoforge: ", NeoForge" }[mp.loader] || "";
      opt.textContent = `📦 ${mp.title} (${mp.gameVersion}${mpLoader})`;
    }
    select.appendChild(opt);
  }
  // krótka lista: polecane wersje i ta, którą gracz ma wybraną; pełna po kliknięciu ostatniej pozycji
  const all = !!settings.allVersions;
  const current = shownVersion || settings.version || "";
  let hidden = 0;
  const visible = (value, featured) => {
    if (all || featured || value === current) return true;
    hidden++;
    return false;
  };
  for (const v of versions) {
    if (v.type !== "release") continue;
    const featured = FEATURED_VERSIONS.includes(v.id);
    const forgePackName = forgeVersions[v.id];
    if ((fabricVersions.has(v.id) || forgePackName) && !(onlyInstalled && !onlyInstalled.includes(v.id)) && visible(`${v.id}|pack`, featured)) {
      const opt = document.createElement("option");
      opt.value = `${v.id}|pack`;
      opt.textContent = forgePackName ? `Minecraft ${v.id} – ${forgePackName} (Forge)` : `Minecraft ${v.id} – ${packName}`;
      select.appendChild(opt);
    }
    if (forgeModern.has(v.id) && !(onlyInstalled && !onlyInstalled.includes(`forge:${v.id}`)) && visible(`${v.id}|forge`, v.id === "1.21.11")) {
      const opt = document.createElement("option");
      opt.value = `${v.id}|forge`;
      opt.textContent = `Minecraft ${v.id} – ${packName} (Forge)`;
      select.appendChild(opt);
    }
    if (neoforge.has(v.id) && !(onlyInstalled && !onlyInstalled.includes(`neoforge:${v.id}`)) && visible(`${v.id}|neoforge`, false)) {
      const opt = document.createElement("option");
      opt.value = `${v.id}|neoforge`;
      opt.textContent = `Minecraft ${v.id} – ${packName} (NeoForge)`;
      select.appendChild(opt);
    }
  }
  if (all || hidden) {
    const opt = document.createElement("option");
    opt.value = TOGGLE_VERSIONS;
    opt.textContent = all ? "▲ Pokaż tylko polecane wersje" : "▼ Pokaż wszystkie wersje…";
    select.appendChild(opt);
  }
  if (current && select.querySelector(`option[value="${current}"]`)) {
    select.value = current;
  } else {
    // bez zapisanego wyboru: najnowsza polecana wersja
    const first = [...select.options].find(o => o.value !== TOGGLE_VERSIONS);
    if (first) select.value = first.value;
  }
  shownVersion = select.value;
}

// ---------- Skin (główka obok nicku) ----------

// Domyślna głowa dla konta non-premium, 8x8 pikseli
const DEFAULT_HEAD = [
  "HHHHHHHH",
  "HHHHHHHH",
  "HSSSSSSH",
  "SSSSSSSS",
  "SWBSSBWS",
  "SSSNNSSS",
  "SSMMMMSS",
  "SsSSSSsS",
];
const HEAD_COLORS = { H: "#3b2a1a", S: "#b98a6a", s: "#a9785a", W: "#ffffff", B: "#4a3a8a", N: "#8a5a40", M: "#6a3a2a" };

// Rysuje głowę na płótnach: karta Konto na Home, avatar w bocznym pasku i karta konta w ustawieniach
function drawHead(skinUrl) {
  const canvases = [$("head"), $("side-head"), $("account-head")];
  const drawDefault = () => {
    for (const c of canvases) {
      const ctx = c.getContext("2d");
      const px = c.width / 8;
      ctx.clearRect(0, 0, c.width, c.height);
      DEFAULT_HEAD.forEach((row, y) => [...row].forEach((ch, x) => {
        ctx.fillStyle = HEAD_COLORS[ch];
        ctx.fillRect(x * px, y * px, px, px);
      }));
    }
  };
  if (!skinUrl) return drawDefault();

  const img = new Image();
  img.onload = () => {
    for (const c of canvases) {
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, c.width, c.height);   // twarz
      ctx.drawImage(img, 40, 8, 8, 8, 0, 0, c.width, c.height);  // druga warstwa (czapka, włosy)
    }
  };
  img.onerror = drawDefault;
  img.src = skinUrl;
}

let premiumAccount = false;

function setAccount(name, skin, offline) {
  premiumAccount = !!name;
  drawHead(name ? skin : null);
  $("account-name").textContent = name || $("nick").value.trim() || "—";
  $("account").textContent = name ? `Konto Microsoft${offline ? " (offline)" : ""}` : "Konto non-premium";
  $("account-kind").textContent = $("account").textContent;
  $("btn-logout").hidden = !name;
  $("home-logout").hidden = !name;
  $("nick").disabled = !!name;
  if (name) $("nick").value = name;
  accountSkin = name ? skin : null;
  renderAccounts();
  homeRefresh("account");
}

// Skin aktywnego konta Microsoft (adres) — Home rysuje z niego całą postać
let accountSkin = null;

// Home (home.js) odświeża swoje karty, gdy zmieni się konto, wersja albo skończy się gra
function homeRefresh(what) {
  if (window.Home) window.Home.refresh(what);
}

// „Graj 1.21.11” — na przycisku widać, którą wersję uruchomi
function playLabel() {
  const version = ($("version").value || "").split("|")[0];
  return /^\d/.test(version) ? `Graj ${version}` : "Graj";
}

// ---------- Zapisane konta ----------
const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;
let accountChoices = [];

function savedNicks() {
  if (!settings.nicks) settings.nicks = settings.nick ? [settings.nick] : [];
  return settings.nicks;
}

function rememberNick(nick) {
  if (!savedNicks().includes(nick)) settings.nicks.push(nick);
}

async function renderAccounts() {
  const microsoft = await window.api.listAccounts();
  const nick = $("nick").value.trim();
  accountChoices = [
    ...microsoft.map(a => ({ type: "ms", id: a.id, name: a.name, active: premiumAccount && a.active })),
    ...savedNicks().map(name => ({ type: "nick", name, active: !premiumAccount && name === nick })),
  ];

  const menu = $("account-menu");
  menu.innerHTML = "";
  for (const choice of accountChoices) {
    const label = `${choice.active ? "✓ " : ""}${choice.name} (${choice.type === "ms" ? "Microsoft" : "non-premium"})`;
    menu.appendChild(accountMenuItem(label, choice.active ? "active" : "", () => useAccount(choice)));
  }
  menu.appendChild(accountMenuItem("Zarządzaj kontami…", "manage", () => showSettingsPage("account")));

  const list = $("accounts-list");
  list.innerHTML = "";
  if (accountChoices.length === 0) list.appendChild(note("Brak zapisanych kont"));
  for (const choice of accountChoices) list.appendChild(accountRow(choice));
}

function accountMenuItem(label, className, action) {
  const item = document.createElement("button");
  item.textContent = label;
  item.className = className;
  item.onclick = () => {
    $("account-menu").hidden = true;
    action();
  };
  return item;
}

function accountRow(choice) {
  const li = document.createElement("li");
  li.className = "result";
  const body = document.createElement("div");
  body.className = "result-body";
  const title = document.createElement("div");
  title.className = "result-title";
  title.textContent = choice.name;
  const kind = document.createElement("span");
  kind.className = `server-tag ${choice.type === "ms" ? "premium" : "cracked"}`;
  kind.textContent = choice.type === "ms" ? "Microsoft" : "non-premium";
  title.appendChild(kind);
  if (choice.active) {
    const active = document.createElement("span");
    active.className = "server-tag active";
    active.textContent = "używane";
    title.appendChild(active);
  }
  body.appendChild(title);

  const use = document.createElement("button");
  use.textContent = "Użyj";
  use.disabled = choice.active;
  use.onclick = () => useAccount(choice);
  const del = document.createElement("button");
  del.textContent = "Usuń";
  del.onclick = () => forgetAccount(choice);
  li.append(body, use, del);
  return li;
}

async function useAccount(choice) {
  if ($("btn-play").disabled) return; // gra działa albo się uruchamia
  if (choice.type === "nick") {
    await window.api.useNick();
    $("nick").value = choice.name;
    setAccount(null);
    persist();
    return;
  }
  setStatus(`Przełączanie na ${choice.name}…`);
  $("accounts-hint").textContent = "";
  try {
    const account = await window.api.switchAccount(choice.id);
    if (account) setAccount(account.name, account.skin, account.offline);
    setStatus("");
  } catch (err) {
    const text = `Nie udało się przełączyć na ${choice.name} — usuń to konto i dodaj je ponownie`;
    log(`${text}: ${err}`);
    setStatus(text);
    $("accounts-hint").textContent = text;
  }
}

async function forgetAccount(choice) {
  if ($("btn-play").disabled) return;
  if (choice.type === "nick") {
    settings.nicks = savedNicks().filter(n => n !== choice.name);
    window.api.saveSettings(settings);
    renderAccounts();
    return;
  }
  await window.api.removeAccount(choice.id);
  if (choice.active) {
    $("nick").value = settings.nick || "";
    setAccount(null);
  } else {
    renderAccounts();
  }
}

$("account-switch").onclick = () => { $("account-menu").hidden = !$("account-menu").hidden; };
document.addEventListener("click", e => {
  if (!e.target.closest(".account-switch-wrap")) $("account-menu").hidden = true;
});

$("btn-add-nick").onclick = () => {
  const nick = $("new-nick").value.trim();
  if (!NICK_RE.test(nick)) {
    $("accounts-hint").textContent = "Nick: 3–16 znaków, litery, cyfry lub _";
    return;
  }
  $("accounts-hint").textContent = "";
  $("new-nick").value = "";
  rememberNick(nick);
  window.api.saveSettings(settings);
  renderAccounts();
};

async function init() {
  settings = await window.api.loadSettings();
  const totalRam = await window.api.totalRam();
  $("app-version").textContent = await window.api.appVersion();

  $("nick").value = settings.nick || "";
  systemRam = totalRam;
  $("ram").max = Math.max(2, totalRam);
  $("ram").value = settings.ram || recommendedRam();
  updateRam();

  const w = settings.window || {};
  $("win-fullscreen").checked = !!w.fullscreen;
  $("win-width").value = w.width || 1280;
  $("win-height").value = w.height || 720;
  updateWindowInputs();
  $("after-launch").value = settings.afterLaunch || "tray";
  $("java-args").value = settings.javaArgs || "";
  $("sync-options").checked = settings.syncOptions !== false;
  $("about-version").textContent = $("app-version").textContent;

  setAccount(null);
  window.api.restoreLogin().then(account => {
    if (account) setAccount(account.name, account.skin, account.offline);
  });

  await loadVersions();
  if (window.Home) window.Home.start(); // Home startuje, gdy są już ustawienia i lista wersji
}

// Lista wersji (też po instalacji/usunięciu modpacka); select = wpis do zaznaczenia
async function loadVersions(select) {
  try {
    const [{ versions, offline, installed, modpacks }, fabric, packName, forge, forgeModern, neoforge] = await Promise.all([
      window.api.listVersions(),
      window.api.fabricVersions().catch(() => []),
      window.api.packName(),
      window.api.forgeVersions().catch(() => ({})),
      window.api.forgeModern().catch(() => []),
      window.api.neoforgeVersions().catch(() => []),
    ]);
    fillVersions(versions, new Set(fabric), packName, offline ? installed : null, modpacks, forge, new Set(forgeModern), new Set(neoforge));
    if (!$("btn-play").disabled) $("play-label").textContent = playLabel();
    homeRefresh("version");
    if (select) {
      shownVersion = select;
      fillVersions(...versionArgs); // wybrana pozycja musi być na liście, także gdy nie jest polecana
      persist();
      homeRefresh("version");
    }
    if (offline) {
      setStatus(installed.length || modpacks.length
        ? "Brak internetu — tryb offline: grasz na pobranych wersjach"
        : "Brak internetu — żadna wersja nie jest jeszcze pobrana");
    }
  } catch (err) {
    $("version").innerHTML = "<option>Brak połączenia</option>";
    setStatus("Nie można pobrać listy wersji — sprawdź internet");
    log(String(err));
  }
}

$("nick").onchange = () => {
  persist();
  if ($("btn-logout").hidden) $("account-name").textContent = $("nick").value.trim() || "—";
  renderAccounts();
};
$("version").onchange = () => {
  const select = $("version");
  if (select.value === TOGGLE_VERSIONS) {
    // to nie jest wersja: przełączamy długość listy i zostajemy przy poprzednim wyborze
    settings.allVersions = !settings.allVersions;
    fillVersions(...versionArgs);
    persist();
    if (select.showPicker) { try { select.showPicker(); } catch {} }
    return;
  }
  shownVersion = select.value;
  persist();
  if (!$("btn-play").disabled) $("play-label").textContent = playLabel();
  homeRefresh("version");
};
// Suwak sięga całej pamięci komputera; podpowiedź ostrzega przed zbyt dużą ilością
let systemRam = 16;

// Około połowy pamięci komputera, w granicach 4–10 GB
function recommendedRam() {
  return Math.min(10, Math.max(4, Math.round(systemRam / 2)));
}

function updateRam() {
  const ram = Number($("ram").value);
  $("ram-val").textContent = `${ram} GB`;
  const slider = $("ram");
  slider.style.setProperty("--fill", `${((ram - slider.min) / (slider.max - slider.min)) * 100}%`);
  document.querySelectorAll(".ram-preset").forEach(b => {
    b.classList.toggle("selected", Number(b.dataset.gb) === ram);
    b.disabled = Number(b.dataset.gb) > systemRam;
  });
  $("btn-ram-auto").textContent = `Zalecane (${recommendedRam()} GB)`;
  const hint = $("ram-hint");
  if (systemRam - ram < 2) {
    hint.className = "bad";
    hint.textContent = `Dla Windowsa zostanie ${Math.max(0, systemRam - ram)} GB — komputer i gra mogą się zacinać`;
  } else if (ram > 12) {
    hint.className = "info";
    hint.textContent = "Ponad 12 GB rzadko pomaga, a może wydłużać przycięcia";
  } else if (ram >= 4) {
    hint.className = "good";
    hint.textContent = "Dobra ilość dla paczki modów";
  } else {
    hint.className = "bad";
    hint.textContent = "Za mało dla paczki modów — ustaw co najmniej 4 GB";
  }
}

$("ram").oninput = updateRam;
$("ram").onchange = persist;

function setRam(gb) {
  $("ram").value = gb;
  updateRam();
  persist();
}
document.querySelectorAll(".ram-preset").forEach(b => { b.onclick = () => setRam(Number(b.dataset.gb)); });
$("btn-ram-auto").onclick = () => setRam(recommendedRam());

// ---------- Pozostałe ustawienia ----------

function updateWindowInputs() {
  const full = $("win-fullscreen").checked;
  $("win-width").disabled = full;
  $("win-height").disabled = full;
}
$("win-fullscreen").onchange = () => { updateWindowInputs(); persist(); };
$("win-width").onchange = persist;
$("win-height").onchange = persist;
$("after-launch").onchange = persist;
$("java-args").onchange = persist;
$("sync-options").onchange = persist;

document.querySelectorAll(".nav-item").forEach(item => {
  item.onclick = () => {
    document.querySelectorAll(".nav-item").forEach(i => i.classList.toggle("active", i === item));
    document.querySelectorAll(".page").forEach(p => { p.hidden = p.dataset.page !== item.dataset.page; });
  };
});

function showSettingsPage(page) {
  document.querySelector(`.nav-item[data-page="${page}"]`).click();
  $("settings").hidden = false;
}

$("btn-game-folder").onclick = () => window.api.diskOpen();
$("btn-log-clear").onclick = () => { $("log").textContent = ""; };
$("btn-log-copy").onclick = async () => {
  await navigator.clipboard.writeText($("log").textContent);
  $("btn-log-copy").textContent = "Skopiowano!";
  setTimeout(() => { $("btn-log-copy").textContent = "Kopiuj"; }, 1500);
};
$("btn-github").onclick = () => window.api.openGithub();
$("btn-check-update").onclick = async () => {
  $("update-status").textContent = "Sprawdzanie…";
  $("update-status").textContent = await window.api.checkUpdate();
};

// ---------- Okno „Własne mody” ----------
let modsTab = "own";
let modsData = { own: [], pre: [] };

function modsVersion() {
  return $("version").value.split("|")[0];
}

// Wybrany wpis z listy: wersja gry + instancja ("pack" albo "mp:<slug>")
function modsTarget() {
  const [version, instance] = $("version").value.split("|");
  return { version, instance };
}

async function loadMods() {
  modsData = await window.api.listMods(modsTarget());
  $("count-own").textContent = `(${modsData.own.length})`;
  $("count-pre").textContent = `(${modsData.pre.length})`;
  renderMods();
  showUpdateButton();
}

function renderMods() {
  if (modsTab === "search") return renderSearch();
  if (isContentTab(modsTab)) return renderContent();
  const query = $("mods-search").value.trim().toLowerCase();
  const list = $("mods-list");
  const mods = modsData[modsTab].filter(m => !query || m.title.toLowerCase().includes(query) || m.file.toLowerCase().includes(query));
  list.innerHTML = "";

  if (mods.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = query ? "Nic nie znaleziono"
      : modsTab === "own" ? "Brak własnych modów — kliknij „Otwórz folder” i wrzuć pliki .jar"
      : "Mody z paczki pojawią się po pierwszym kliknięciu „Graj” na tej wersji";
    list.appendChild(li);
  }

  for (const mod of mods) {
    const li = document.createElement("li");
    li.classList.toggle("off", !mod.enabled);
    li.title = mod.file;

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = mod.enabled;

    const title = document.createElement("span");
    title.className = "mod-title";
    title.textContent = mod.title;
    li.append(box, title);

    if (mod.library) {
      const tag = document.createElement("span");
      tag.className = "mod-tag";
      tag.textContent = "biblioteka";
      li.appendChild(tag);
    }
    // własny mod, który i tak jest w paczce — można go usunąć z folderu
    if (modsTab === "own" && mod.modId && modsData.pre.some(p => p.modId === mod.modId)) {
      const tag = document.createElement("span");
      tag.className = "mod-tag";
      tag.textContent = "jest też w paczce";
      tag.title = "Ten mod jest już w paczce xBobersonx Mods — kopia we własnych modach nie jest potrzebna";
      li.appendChild(tag);
    }
    const update = modsTab === "own" && modUpdates.get(mod.key);
    const version = document.createElement("span");
    version.className = "mod-version";
    version.textContent = update ? `${update.from} → ${update.to}` : mod.version;
    if (update) {
      version.classList.add("has-update");
      version.title = update.changelog || "";
    }
    li.appendChild(version);

    if (update) {
      const btn = document.createElement("button");
      btn.className = "small primary";
      btn.textContent = "Aktualizuj";
      btn.onclick = async e => {
        e.stopPropagation();
        btn.disabled = true;
        btn.textContent = "…";
        await updateOneMod(update);
        await loadMods();
      };
      li.appendChild(btn);
    }

    const toggle = async () => {
      const enabled = !mod.enabled;
      try {
        await window.api.toggleMod({ ...modsTarget(), tab: modsTab, key: mod.key, enabled });
        mod.enabled = enabled;
        $("mods-hint").textContent = mod.library && !enabled
          ? "Uwaga: inne mody mogą wymagać tej biblioteki — gra może się nie uruchomić."
          : "";
      } catch (err) {
        $("mods-hint").textContent = cleanError(err);
      }
      renderMods();
    };
    li.onclick = e => { if (e.target !== box && e.target.tagName !== "BUTTON") toggle(); };
    box.onchange = toggle;
    list.appendChild(li);
  }
}

// ---------- Aktualizacje własnych modów ----------
let modUpdates = new Map(); // plik -> { file, from, to, changelog }

async function updateOneMod(update) {
  try {
    await window.api.updateMod({ ...modsTarget(), file: update.file });
    modUpdates.delete(update.file);
    $("mods-hint").textContent = `Zaktualizowano do ${update.to}`;
    return true;
  } catch (err) {
    $("mods-hint").textContent = cleanError(err);
    return false;
  }
}

function showUpdateButton() {
  const btn = $("btn-mods-updates");
  btn.hidden = modsTab !== "own" || modsData.own.length === 0;
  btn.disabled = false;
  btn.textContent = modUpdates.size ? `Aktualizuj wszystkie (${modUpdates.size})` : "Sprawdź aktualizacje";
}

$("btn-mods-updates").onclick = async () => {
  const btn = $("btn-mods-updates");
  btn.disabled = true;
  if (modUpdates.size) {
    btn.textContent = "Aktualizowanie…";
    let done = 0;
    for (const update of [...modUpdates.values()]) if (await updateOneMod(update)) done++;
    $("mods-hint").textContent = `Zaktualizowano ${done} ${done === 1 ? "mod" : "modów"}`;
    await loadMods();
  } else {
    btn.textContent = "Sprawdzanie…";
    try {
      const updates = await window.api.checkModUpdates(modsTarget());
      modUpdates = new Map(updates.map(u => [u.file, u]));
      $("mods-hint").textContent = updates.length
        ? `Aktualizacje dostępne dla ${updates.length} ${updates.length === 1 ? "moda" : "modów"}`
        : "Wszystkie własne mody są aktualne (sprawdzono te, które są na Modrinth)";
      renderMods();
    } catch (err) {
      $("mods-hint").textContent = "Nie udało się sprawdzić — sprawdź internet";
    }
  }
  showUpdateButton();
};

// ---------- Zakładka „Szukaj modów” (Modrinth) ----------
let searchResults = null; // null = trwa wyszukiwanie
let searchError = "";
let searchTimer = null;
let searchSeq = 0;

function niceNumber(n) {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} mln` : n >= 1e3 ? `${Math.round(n / 1e3)} tys.` : String(n);
}

function cleanError(err) {
  return String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

const isContentTab = tab => tab === "shader" || tab === "resourcepack";
let contentInstalled = [];

async function doSearch() {
  const seq = ++searchSeq;
  const tab = modsTab;
  searchResults = null;
  searchError = "";
  renderMods();
  try {
    const query = $("mods-search").value.trim();
    const results = isContentTab(tab)
      ? await window.api.searchContent({ ...modsTarget(), type: tab, query })
      : await window.api.searchMods({ ...modsTarget(), query });
    if (seq !== searchSeq) return;
    searchResults = results;
  } catch (err) {
    if (seq !== searchSeq) return;
    searchResults = [];
    searchError = "Nie udało się połączyć z Modrinth — sprawdź internet";
  }
  renderMods();
}

function renderSearch() {
  const list = $("mods-list");
  list.innerHTML = "";
  if (!searchResults || searchResults.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = !searchResults ? "Szukanie…" : searchError || "Nic nie znaleziono";
    list.appendChild(li);
    return;
  }
  for (const mod of searchResults) list.appendChild(resultItem(mod, installModResult));
}

async function installModResult(mod) {
  const files = await window.api.installMod({ ...modsTarget(), id: mod.id });
  await loadMods();
  return files.length > 1
    ? `Zainstalowano ${mod.title} + ${files.length - 1} wymaganych bibliotek`
    : `Zainstalowano ${mod.title}`;
}

// ---------- Zakładki „Shadery” i „Tekstury” ----------

async function loadContent() {
  if (!isContentTab(modsTab)) return;
  contentInstalled = await window.api.listContent({ ...modsTarget(), type: modsTab });
  renderMods();
}

function section(text) {
  const li = document.createElement("li");
  li.className = "section";
  li.textContent = text;
  return li;
}

// Zwykły tekst w liście (np. „Szukanie…”, „Nic nie znaleziono”)
function note(text) {
  const li = section(text);
  li.classList.add("note");
  return li;
}

function contentRow(item, type) {
  const li = document.createElement("li");
  li.classList.toggle("on", item.enabled);
  const input = document.createElement("input");
  input.type = type === "shader" ? "radio" : "checkbox";
  input.name = "shader";
  input.checked = item.enabled;
  const title = document.createElement("span");
  title.className = "mod-title";
  title.textContent = item.title;
  li.append(input, title);

  const set = async enabled => {
    try {
      await window.api.toggleContent({ ...modsTarget(), type, file: item.file, enabled });
      $("mods-hint").textContent = "";
    } catch (err) {
      $("mods-hint").textContent = cleanError(err);
    }
    await loadContent();
  };
  // shader: kliknięcie wybiera go (jak przełącznik); paczka tekstur: włącza/wyłącza
  const click = () => set(type === "shader" ? true : !item.enabled);
  li.onclick = e => { if (e.target !== input && e.target.tagName !== "BUTTON") click(); };
  input.onchange = click;

  if (item.file) {
    const del = document.createElement("button");
    del.className = "small";
    del.textContent = "Usuń";
    del.onclick = async () => {
      try {
        await window.api.deleteContent({ ...modsTarget(), type, file: item.file });
      } catch (err) {
        $("mods-hint").textContent = cleanError(err);
      }
      await loadContent();
      if (searchResults) doSearch();
    };
    li.appendChild(del);
  }
  return li;
}

function renderContent() {
  const type = modsTab;
  const list = $("mods-list");
  list.innerHTML = "";

  list.appendChild(section(`Zainstalowane (${contentInstalled.length})`));
  if (type === "shader") {
    const none = contentRow({ title: "Bez shaderów", enabled: !contentInstalled.some(i => i.enabled) }, type);
    none.onclick = async () => {
      await window.api.toggleContent({ ...modsTarget(), type, file: null, enabled: false });
      await loadContent();
    };
    list.appendChild(none);
  } else if (contentInstalled.length === 0) {
    list.appendChild(note("Nic jeszcze nie zainstalowano — wybierz coś poniżej"));
  }
  for (const item of contentInstalled) list.appendChild(contentRow(item, type));

  list.appendChild(section(type === "shader" ? "Shadery do pobrania (Modrinth, działają z Iris)" : "Paczki tekstur do pobrania (Modrinth)"));
  if (!searchResults || searchResults.length === 0) {
    list.appendChild(note(!searchResults ? "Szukanie…" : searchError || "Nic nie znaleziono"));
    return;
  }
  for (const item of searchResults) {
    list.appendChild(resultItem(item, async () => {
      await window.api.installContent({ ...modsTarget(), type, id: item.id });
      await loadContent();
      return type === "shader"
        ? `Zainstalowano i włączono shader ${item.title}`
        : `Zainstalowano i włączono paczkę tekstur ${item.title}`;
    }));
  }
}

// Wiersz wyniku wyszukiwania z przyciskiem „Zainstaluj”; install() zwraca tekst podpowiedzi
function resultItem(mod, install, hintId = "mods-hint") {
  const li = document.createElement("li");
  li.className = "result";

  const icon = document.createElement("img");
  icon.className = "result-icon";
  if (mod.icon) icon.src = mod.icon;
  icon.alt = "";

  const body = document.createElement("div");
  body.className = "result-body";
  const title = document.createElement("div");
  title.className = "result-title";
  title.textContent = mod.title + " ";
  const author = document.createElement("small");
  author.textContent = `od ${mod.author}`;
  title.appendChild(author);
  const desc = document.createElement("div");
  desc.className = "result-desc";
  desc.textContent = mod.description;
  const meta = document.createElement("div");
  meta.className = "result-meta";
  meta.textContent = `${niceNumber(mod.downloads)} pobrań`;
  body.append(title, desc, meta);

  const button = document.createElement("button");
  button.textContent = mod.installed ? "Zainstalowany" : "Zainstaluj";
  button.disabled = mod.installed;
  if (!mod.installed) button.classList.add("primary");
  button.onclick = async () => {
    button.disabled = true;
    button.textContent = "Instalowanie…";
    try {
      const hint = await install(mod);
      mod.installed = true;
      button.textContent = "Zainstalowany";
      button.classList.remove("primary");
      $(hintId).textContent = hint;
    } catch (err) {
      button.disabled = false;
      button.textContent = "Zainstaluj";
      $(hintId).textContent = cleanError(err);
    }
  };

  li.append(icon, body, button);
  return li;
}

function setModsTab(tab) {
  modsTab = tab;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
  $("mods-hint").textContent = "";
  $("mods-search").value = "";
  $("mods-search").placeholder = tab === "search" || isContentTab(tab) ? "Szukaj na Modrinth…" : "Szukaj…";
  $("btn-mods-folder").hidden = tab === "search";
  showUpdateButton();
  $("mods-list").scrollTop = 0;
  if (isContentTab(tab)) {
    contentInstalled = [];
    loadContent();
  }
  if (tab === "search" || isContentTab(tab)) doSearch();
  else renderMods();
}

$("btn-mods").onclick = async () => {
  const option = $("version").selectedOptions[0];
  if (!option || !option.value.includes("|")) return;
  $("mods-title").textContent = `Mody — ${option.textContent}`;
  $("mods-search").value = "";
  modUpdates = new Map();
  // modpack nie ma paczki xBobersonx — jego mody są w zakładce „Własne mody”; profil — tylko jeśli ją wybrano
  const { instance } = modsTarget();
  const info = instance && instance.startsWith("mp:") ? instanceInfo.get(instance.slice(3)) : null;
  document.querySelector('.tab[data-tab="pre"]').hidden = !(["pack", "forge", "neoforge"].includes(instance) || (info && info.pack));
  // shadery działają przez Iris, a Iris jest dopiero od 1.16 — na starszych wersjach zakładka by była pusta
  const minor = Number(modsTarget().version.split(".")[1]);
  document.querySelector('.tab[data-tab="shader"]').hidden = !!minor && minor < 16;
  setModsTab("own");
  $("mods").hidden = false;
  await loadMods();
};
document.querySelectorAll(".tab").forEach(t => { t.onclick = () => setModsTab(t.dataset.tab); });
$("mods-search").oninput = () => {
  if (modsTab !== "search" && !isContentTab(modsTab)) return renderMods();
  clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 400);
};
$("btn-close-mods").onclick = () => { $("mods").hidden = true; };
$("btn-mods-folder").onclick = () =>
  window.api.openMods({ ...modsTarget(), preinstalled: modsTab === "pre", content: isContentTab(modsTab) ? modsTab : null });
window.addEventListener("focus", () => {
  if ($("mods").hidden) return;
  loadMods();
  loadContent();
});
$("btn-settings").onclick = () => { $("settings").hidden = false; };

// ---------- Aktualizacje launchera ----------
window.api.on("update:available", version => {
  $("update-bar").hidden = false;
  $("update-text").textContent = `Pobieranie aktualizacji ${version}…`;
});
window.api.on("update:progress", percent => {
  $("update-text").textContent = `Pobieranie aktualizacji… ${percent}%`;
});
window.api.on("update:ready", version => {
  $("update-bar").hidden = false;
  $("update-text").textContent = `Nowa wersja ${version} jest gotowa`;
  $("btn-update").hidden = false;
});
$("btn-update").onclick = () => window.api.installUpdate();
$("btn-close-settings").onclick = () => { $("settings").hidden = true; };

$("btn-ms").onclick = async () => {
  try {
    const { name, skin } = await window.api.loginMicrosoft();
    setAccount(name, skin);
  } catch (err) {
    log(`Logowanie nieudane: ${err}`);
    setStatus(`Logowanie nieudane: ${cleanError(err)}`);
  }
};
$("btn-logout").onclick = async () => {
  await window.api.logout();
  $("nick").value = settings.nick || "";
  setAccount(null);
};

// server = adres serwera, na który gra wchodzi od razu po starcie;
// world = folder świata (Minecraft 1.20+), do którego gra wchodzi od razu
async function startGame(server, world) {
  const nick = $("nick").value.trim();
  if (!NICK_RE.test(nick)) {
    setStatus("Nick: 3–16 znaków, litery, cyfry lub _");
    return;
  }
  const [version, loader] = $("version").value.split("|");
  if (!loader || $("btn-play").disabled) return;

  if (!premiumAccount) rememberNick(nick);
  persist();
  renderAccounts();
  setPlaying(true);
  setStatus(server ? `Przygotowywanie… (potem wejście na ${server})` : "Przygotowywanie…", 0);
  try {
    await window.api.launch({
      nick,
      version,
      ram: Number($("ram").value),
      loader,
      window: settings.window,
      afterLaunch: settings.afterLaunch || "tray",
      javaArgs: settings.javaArgs || "",
      syncOptions: settings.syncOptions !== false,
      server,
      world,
    });
  } catch (err) {
    setStatus("Błąd uruchamiania — szczegóły w ustawieniach (⚙)");
    log(String(err));
    setPlaying(false);
  }
}

$("btn-play").onclick = () => startGame();

function setPlaying(on) {
  $("btn-play").disabled = on;
  $("account-switch").disabled = on;
  $("account-menu").hidden = true;
  $("play-label").textContent = on ? "Uruchamianie…" : playLabel();
}

const STAGES = {
  mods: "Mody",
  java: "Java",
  assets: "Zasoby gry",
  "assets-copy": "Kopiowanie zasobów",
  classes: "Biblioteki",
  "classes-custom": "Biblioteki Fabric",
  "classes-maven-custom": "Biblioteki Fabric",
  natives: "Pliki systemowe",
};

window.api.on("game:progress", p => {
  const percent = p.total ? Math.round((p.task / p.total) * 100) : 0;
  setStatus(`${STAGES[p.type] || p.type}: ${p.task}/${p.total}`, percent);
});
window.api.on("game:log", log);
window.api.on("game:started", () => {
  setStatus("Gra uruchomiona!", 100);
  $("play-label").textContent = "Gra działa";
});
window.api.on("game:closed", code => {
  setStatus(code === 0 || code === null ? "" : `Gra zamknięta (kod ${code})`);
  document.querySelector(".progress").hidden = true;
  setPlaying(false);
  homeRefresh("played");
});

// ---------- Okno „Gra się wysypała” ----------
let crashReport = null;

window.api.on("game:crash", crash => {
  crashReport = crash.report;
  $("crash-reason").textContent = crash.reason;
  $("crash-details").textContent = crash.details.join("\n");
  $("crash-details").hidden = crash.details.length === 0;
  $("btn-crash-report").hidden = !crash.report;
  setStatus("Gra się wysypała — zobacz okno z wyjaśnieniem");

  const list = $("crash-mods");
  list.innerHTML = "";
  for (const mod of crash.mods) {
    const li = document.createElement("li");
    li.classList.toggle("off", !mod.enabled);
    const title = document.createElement("span");
    title.className = "mod-title";
    title.textContent = `${mod.title}${mod.tab === "own" ? " (własny mod)" : ""}${mod.library ? " — biblioteka" : ""}`;
    const button = document.createElement("button");
    button.textContent = mod.enabled ? "Wyłącz" : "Wyłączony";
    button.disabled = !mod.enabled;
    button.onclick = async () => {
      try {
        await window.api.toggleMod({ version: crash.version, instance: crash.instance, tab: mod.tab, key: mod.key, enabled: false });
        li.classList.add("off");
        button.textContent = "Wyłączony";
        button.disabled = true;
      } catch (err) {
        button.textContent = cleanError(err);
      }
    };
    li.append(title, button);
    list.appendChild(li);
  }
  for (const id of crash.unknown) {
    const li = document.createElement("li");
    li.textContent = `${id} (wbudowany w inny mod — nie da się wyłączyć osobno)`;
    list.appendChild(li);
  }
  $("crash-mods-box").hidden = crash.mods.length + crash.unknown.length === 0;
  $("crash").hidden = false;
});

const closeCrash = () => { $("crash").hidden = true; };
$("btn-crash-ok").onclick = closeCrash;
$("btn-close-crash").onclick = closeCrash;
$("btn-crash-report").onclick = () => crashReport && window.api.openCrashReport(crashReport);
$("btn-crash-log").onclick = () => {
  closeCrash();
  showSettingsPage("console");
};

// ---------- Okno „Miejsce na dysku” ----------

function niceSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return bytes === 0 ? "0 KB" : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function diskRow(name, detail, size, max, button) {
  const li = document.createElement("li");
  const label = document.createElement("span");
  label.className = "disk-name";
  label.textContent = name;
  if (detail) {
    const small = document.createElement("small");
    small.textContent = detail;
    label.appendChild(small);
  }
  const bar = document.createElement("div");
  bar.className = "disk-bar";
  const fill = document.createElement("div");
  fill.style.width = `${Math.max(2, Math.round((size / max) * 100))}%`;
  bar.appendChild(fill);
  const value = document.createElement("span");
  value.className = "disk-size";
  value.textContent = niceSize(size);
  li.append(label, bar, value);
  if (button) li.appendChild(button);
  return li;
}

async function loadDisk() {
  $("disk-total").textContent = "Liczenie…";
  $("disk-list").innerHTML = "";
  const data = await window.api.diskScan();
  $("disk-total").innerHTML = `Gra zajmuje razem: <b>${niceSize(data.total)}</b>`;
  const max = Math.max(...data.versions.map(v => v.size), ...data.shared.map(s => s.size), 1);
  const list = $("disk-list");

  list.appendChild(section(`Wersje gry (${data.versions.length})`));
  for (const v of data.versions) {
    const p = v.parts;
    const detail = `światy ${niceSize(p.saves)} (${v.worlds}) · mody ${niceSize(p.mods)} · shadery i tekstury ${niceSize(p.content)} · reszta ${niceSize(p.other)}`;
    const del = document.createElement("button");
    del.textContent = "Usuń";
    del.onclick = async () => {
      try {
        const freed = await window.api.diskDeleteVersion({ key: v.key, label: v.label, worlds: v.worlds });
        if (freed === null) return;
        $("disk-hint").textContent = `Usunięto ${v.label} — zwolniono ${niceSize(freed)}`;
        loadDisk();
        loadVersions();
      } catch (err) {
        $("disk-hint").textContent = cleanError(err);
      }
    };
    list.appendChild(diskRow(v.label, detail, v.size, max, del));
  }

  list.appendChild(section("Pliki wspólne"));
  for (const s of data.shared) list.appendChild(diskRow(s.label, "", s.size, max));

  list.appendChild(section(`Śmieci do wyczyszczenia: ${niceSize(data.junkSize)}`));
  if (data.junk.length === 0) list.appendChild(diskRow("Nic do sprzątania 🎉", "", 0, max));
  for (const j of data.junk) list.appendChild(diskRow(j.label, "", j.size, max));
  $("btn-disk-clean").disabled = data.junkSize === 0;
}

$("btn-disk").onclick = () => {
  $("settings").hidden = true;
  $("disk-hint").textContent = "";
  $("disk").hidden = false;
  loadDisk();
};
$("btn-close-disk").onclick = () => { $("disk").hidden = true; };
$("btn-disk-open").onclick = () => window.api.diskOpen();
$("btn-disk-clean").onclick = async () => {
  try {
    const freed = await window.api.diskClean();
    $("disk-hint").textContent = `Wyczyszczono — zwolniono ${niceSize(freed)}`;
    loadDisk();
  } catch (err) {
    $("disk-hint").textContent = cleanError(err);
  }
};

// ---------- Okno „Modpacki” ----------
let modpacksInstalled = [];
let modpackResults = null; // null = trwa wyszukiwanie
let modpacksTimer = null;
let modpacksSeq = 0;
let modpackInstalling = false;

function modpackRow(mp) {
  const li = document.createElement("li");
  li.className = "result";
  const icon = document.createElement("img");
  icon.className = "result-icon";
  icon.src = mp.icon || "assets/icon.png";
  icon.alt = "";
  if (mp.kind === "profile") icon.classList.add("profile-icon");
  const body = document.createElement("div");
  body.className = "result-body";
  const title = document.createElement("div");
  title.className = "result-title";
  title.textContent = mp.title;
  const meta = document.createElement("div");
  meta.className = "result-meta";
  const loaderName = LOADER_NAMES[mp.loader] || "Fabric";
  const played = instancePlay(`mp:${mp.slug}`);
  meta.textContent = [
    ...(mp.kind === "profile"
      ? ["Profil", `Minecraft ${mp.gameVersion}`, loaderName, ...(mp.pack ? [`z paczką ${loaderSets.packName || "xBobersonx"}`] : []), ...(mp.ram ? [`${mp.ram} GB RAM`] : [])]
      : [`Minecraft ${mp.gameVersion}`, loaderName, ...(mp.version ? [`wersja ${mp.version}`] : [])]),
    played.seconds ? `grano ${formatDuration(played.seconds)}` : "jeszcze nie grano",
  ].join(" · ");
  if (played.last) meta.title = `Ostatnio: ${new Date(played.last).toLocaleString("pl-PL")} · sesji: ${played.sessions}`;
  body.append(title, meta);

  const buttons = document.createElement("div");
  buttons.className = "result-buttons";
  const play = document.createElement("button");
  play.className = "primary";
  play.textContent = "Wybierz";
  play.onclick = async () => {
    await loadVersions(`${mp.gameVersion}|mp:${mp.slug}`);
    $("modpacks").hidden = true;
    setStatus(`Wybrano ${mp.title} — kliknij „Graj”`);
  };
  const del = document.createElement("button");
  del.textContent = "Usuń";
  del.onclick = async () => {
    try {
      if (!(await window.api.deleteModpack({ slug: mp.slug, title: mp.title }))) return;
      $("modpacks-hint").textContent = `Usunięto ${mp.title}`;
      await loadVersions();
      await loadModpacks();
    } catch (err) {
      $("modpacks-hint").textContent = cleanError(err);
    }
  };
  const duplicate = async () => {
    $("modpacks-hint").textContent = `Kopiowanie ${mp.title}…`;
    const info = await window.api.duplicateProfile({ slug: mp.slug });
    await loadVersions();
    await loadModpacks();
    $("modpacks-hint").textContent = `Utworzono kopię: ${info.title}`;
  };
  const exportProfile = async () => {
    $("modpacks-hint").textContent = `Eksportowanie ${mp.title}…`;
    const result = await window.api.exportProfile({ slug: mp.slug });
    $("modpacks-hint").textContent = result
      ? `Zapisano ${result.title}${result.worlds ? " ze światami" : ""} — plik możesz wysłać znajomemu (${result.downloads} plików pobierze się z Modrinth, ${result.overrides} jest w środku)`
      : "";
  };
  // rzadsze akcje w menu „⋯”, żeby wiersz się nie rozjeżdżał
  const more = document.createElement("button");
  more.className = "more";
  more.textContent = "⋯";
  more.title = "Więcej";
  more.onclick = async () => {
    const action = await window.api.modpackMenu({ profile: mp.kind === "profile" });
    if (!action) return;
    if (action === "backups") return openBackups(mp);
    if (action === "delete") return del.onclick();
    more.disabled = true;
    try {
      await (action === "duplicate" ? duplicate() : exportProfile());
    } catch (err) {
      $("modpacks-hint").textContent = cleanError(err);
    } finally {
      more.disabled = false;
    }
  };
  if (mp.kind === "profile") {
    const editBtn = document.createElement("button");
    editBtn.textContent = "Edytuj";
    editBtn.onclick = () => openProfileDialog(mp);
    buttons.append(play, editBtn, more);
  } else {
    buttons.append(play, more);
  }
  li.append(icon, body, buttons);
  return li;
}

// ---------- Statystyki gry ----------
let playData = { versions: {}, history: [] };

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${Math.max(1, m)} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

// Suma dla instancji (profil może zmieniać wersję gry — czas liczy się razem)
function instancePlay(instance) {
  const out = { seconds: 0, sessions: 0, last: 0, longest: 0 };
  for (const [key, secs] of Object.entries(playData.versions || {})) {
    if (key.slice(key.indexOf("|") + 1) !== instance) continue;
    const s = (playData.stats || {})[key] || {};
    out.seconds += secs;
    out.sessions += s.sessions || 0;
    out.last = Math.max(out.last, s.last || 0);
    out.longest = Math.max(out.longest, s.longest || 0);
  }
  // „ostatnio” ze starszych wersji launchera, które nie zapisywały statystyk
  for (const h of playData.history || []) if (h.key && h.key.slice(h.key.indexOf("|") + 1) === instance) out.last = Math.max(out.last, h.at || 0);
  return out;
}

function playName(version, instance, modpacks) {
  if (instance.startsWith("mp:")) {
    const mp = modpacks.find(m => m.slug === instance.slice(3));
    if (mp) return `${mp.kind === "profile" ? "🧩" : "📦"} ${mp.title}`;
    const slug = instance.slice(3);
    return slug.startsWith("profile-") ? `Usunięty profil (${slug.slice(8)})` : `Usunięty modpack (${slug.replace(/^file-/, "")})`;
  }
  const opt = [...$("version").options].find(o => o.value === `${version}|${instance}`);
  if (opt) return opt.textContent;
  const names = { pack: `z paczką ${loaderSets.packName || "xBobersonx"}`, forge: "Forge", neoforge: "NeoForge", vanilla: "bez modów", fabric: "Fabric" };
  return `Minecraft ${version}${names[instance] ? ` · ${names[instance]}` : ""}`;
}

async function openStats() {
  $("settings").hidden = true;
  $("stats").hidden = false;
  let modpacks = [];
  try {
    [playData, modpacks] = await Promise.all([window.api.getPlaytime(), window.api.listModpacks()]);
  } catch {}
  const versions = playData.versions || {}, stats = playData.stats || {}, days = playData.days || {};

  // wiersze: profile i modpacki razem ze wszystkich wersji, reszta osobno na wersję
  const rows = new Map();
  for (const [key, secs] of Object.entries(versions)) {
    const version = key.slice(0, key.indexOf("|")), instance = key.slice(key.indexOf("|") + 1);
    const id = instance.startsWith("mp:") ? instance : key;
    const row = rows.get(id) || { name: playName(version, instance, modpacks), seconds: 0, sessions: 0, last: 0 };
    const s = stats[key] || {};
    row.seconds += secs;
    row.sessions += s.sessions || 0;
    row.last = Math.max(row.last, s.last || 0);
    rows.set(id, row);
  }
  for (const h of playData.history || []) {
    if (!h.key) continue;
    const instance = h.key.slice(h.key.indexOf("|") + 1);
    const row = rows.get(instance.startsWith("mp:") ? instance : h.key);
    if (row) row.last = Math.max(row.last, h.at || 0);
  }
  const list = [...rows.values()].filter(r => r.seconds > 0).sort((a, b) => b.seconds - a.seconds);
  const total = list.reduce((sum, r) => sum + r.seconds, 0);
  const sessions = Object.values(stats).reduce((sum, s) => sum + (s.sessions || 0), 0);
  const longest = Object.values(stats).reduce((max, s) => Math.max(max, s.longest || 0), 0);
  const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const last14 = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    last14.push({ date: d, seconds: days[dayKey(d)] || 0 });
  }
  const week = last14.slice(-7).reduce((sum, d) => sum + d.seconds, 0);

  const tiles = $("stats-tiles");
  tiles.innerHTML = "";
  for (const [value, label] of [
    [total ? formatDuration(total) : "0 min", "łącznie"],
    [week ? formatDuration(week) : "0 min", "ostatnie 7 dni"],
    [sessions ? String(sessions) : "—", "sesji gry"],
    [longest ? formatDuration(longest) : "—", "najdłuższa sesja"],
  ]) {
    const tile = document.createElement("div");
    tile.className = "stats-tile";
    const b = document.createElement("b");
    b.textContent = value;
    const span = document.createElement("span");
    span.textContent = label;
    tile.append(b, span);
    tiles.appendChild(tile);
  }

  const chart = $("stats-chart");
  chart.innerHTML = "";
  const maxDay = Math.max(...last14.map(d => d.seconds), 1);
  for (const d of last14) {
    const col = document.createElement("div");
    col.className = "day";
    col.title = `${d.date.toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" })}: ${d.seconds ? formatDuration(d.seconds) : "nie grano"}`;
    const bar = document.createElement("div");
    bar.className = d.seconds ? "bar" : "bar empty";
    bar.style.height = `${d.seconds ? Math.max(6, (d.seconds / maxDay) * 100) : 3}%`;
    const label = document.createElement("div");
    label.className = "label";
    label.textContent = d.date.toLocaleDateString("pl-PL", { weekday: "short" }).slice(0, 2);
    col.append(bar, label);
    chart.appendChild(col);
  }

  const ul = $("stats-list");
  ul.innerHTML = "";
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Jeszcze nie grano — statystyki pojawią się po pierwszej grze";
    ul.appendChild(li);
  }
  for (const r of list) {
    const li = document.createElement("li");
    li.className = "result";
    const body = document.createElement("div");
    body.className = "result-body";
    const title = document.createElement("div");
    title.className = "result-title";
    title.textContent = r.name;
    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = [
      formatDuration(r.seconds),
      `${Math.round((r.seconds / total) * 100)}% czasu`,
      ...(r.sessions ? [`sesji: ${r.sessions}`] : []),
      ...(r.last ? [`ostatnio ${new Date(r.last).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" })}`] : []),
    ].join(" · ");
    const share = document.createElement("div");
    share.className = "stats-share";
    const fill = document.createElement("div");
    fill.style.width = `${(r.seconds / list[0].seconds) * 100}%`;
    share.appendChild(fill);
    body.append(title, meta, share);
    li.appendChild(body);
    ul.appendChild(li);
  }
  $("stats-note").textContent = playData.stats
    ? "Liczy się czas od startu gry do jej zamknięcia."
    : "Sesje, najdłuższa sesja i wykres dni liczą się od tej wersji launchera — wcześniejszy czas gry jest wliczony do sumy.";
}
window.openStats = openStats;
$("btn-stats").onclick = openStats;
$("btn-close-stats").onclick = () => { $("stats").hidden = true; };

// ---------- Kopie zapasowe światów ----------
let backupsOf = null; // profil albo modpack, którego kopie są otwarte

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function openBackups(mp) {
  backupsOf = mp;
  $("backups-title").textContent = `Kopie światów — ${mp.title}`;
  $("backups-hint").textContent = "";
  $("backups").hidden = false;
  await loadBackups();
}

async function loadBackups() {
  const mp = backupsOf;
  const list = $("backups-list");
  let data;
  try {
    data = await window.api.listBackups({ slug: mp.slug });
  } catch (err) {
    $("backups-hint").textContent = cleanError(err);
    return;
  }
  if (mp !== backupsOf) return;
  const select = $("backups-world");
  const chosen = select.value;
  select.innerHTML = "";
  for (const w of data.worlds) {
    const opt = document.createElement("option");
    opt.value = w.name;
    opt.textContent = `${w.name} (${formatSize(w.size)})`;
    select.appendChild(opt);
  }
  if (data.worlds.some(w => w.name === chosen)) select.value = chosen;
  select.disabled = $("btn-backup-create").disabled = data.worlds.length === 0;
  if (!data.worlds.length) {
    const opt = document.createElement("option");
    opt.textContent = "Brak światów — zagraj, żeby jakiś utworzyć";
    select.appendChild(opt);
  }

  list.innerHTML = "";
  if (!data.backups.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Nie ma jeszcze kopii. Launcher zrobi je sam przed zmianą wersji albo loadera profilu.";
    list.appendChild(li);
    return;
  }
  for (const b of data.backups) {
    const li = document.createElement("li");
    li.className = "result";
    const body = document.createElement("div");
    body.className = "result-body";
    const title = document.createElement("div");
    title.className = "result-title";
    title.textContent = b.world;
    const meta = document.createElement("div");
    meta.className = "result-meta";
    meta.textContent = [new Date(b.created).toLocaleString("pl-PL"), formatSize(b.size), b.auto ? `automatyczna${b.reason ? `, ${b.reason}` : ""}` : "ręczna"].join(" · ");
    body.append(title, meta);
    const buttons = document.createElement("div");
    buttons.className = "result-buttons";
    const restore = document.createElement("button");
    restore.className = "primary";
    restore.textContent = "Przywróć";
    restore.onclick = () => backupAction(restore, async () => {
      const result = await window.api.restoreBackup({ slug: mp.slug, file: b.file });
      return result && `Przywrócono świat ${result.world}${result.saved ? " — poprzedni stan jest zapisany jako kopia" : ""}`;
    });
    const del = document.createElement("button");
    del.textContent = "Usuń";
    del.onclick = () => backupAction(del, async () =>
      (await window.api.deleteBackup({ slug: mp.slug, file: b.file })) && "Usunięto kopię");
    buttons.append(restore, del);
    li.append(body, buttons);
    list.appendChild(li);
  }
}

async function backupAction(button, run) {
  button.disabled = true;
  try {
    const message = await run();
    if (message) $("backups-hint").textContent = message;
    await loadBackups();
  } catch (err) {
    $("backups-hint").textContent = cleanError(err);
  } finally {
    button.disabled = false;
  }
}

$("btn-close-backups").onclick = () => { $("backups").hidden = true; backupsOf = null; };
$("btn-backups-folder").onclick = () => backupsOf && window.api.openBackups({ slug: backupsOf.slug });
$("backups-add").onsubmit = event => {
  event.preventDefault();
  const world = $("backups-world").value;
  if (!backupsOf || !world) return;
  $("backups-hint").textContent = `Zapisywanie kopii ${world}…`;
  backupAction($("btn-backup-create"), async () => {
    const made = await window.api.createBackup({ slug: backupsOf.slug, world });
    return `Zapisano kopię ${made.world} (${formatSize(made.size)})`;
  });
};

function renderModpacks() {
  const list = $("modpacks-list");
  list.innerHTML = "";
  const profiles = modpacksInstalled.filter(m => m.kind === "profile");
  const packs = modpacksInstalled.filter(m => m.kind !== "profile");
  list.appendChild(section(`Twoje profile (${profiles.length})`));
  if (profiles.length === 0) {
    list.appendChild(note("Brak profili — kliknij „Nowy profil…”, żeby zrobić np. osobny profil pod PvP i pod Survival"));
  }
  for (const mp of profiles) list.appendChild(modpackRow(mp));
  list.appendChild(section(`Zainstalowane modpacki (${packs.length})`));
  if (packs.length === 0) {
    list.appendChild(note("Nic jeszcze nie zainstalowano — wybierz modpack poniżej"));
  }
  for (const mp of packs) list.appendChild(modpackRow(mp));

  list.appendChild(section("Modpacki do pobrania (Modrinth, Fabric)"));
  if (!modpackResults || modpackResults.length === 0) {
    list.appendChild(note(!modpackResults ? "Szukanie…" : "Nic nie znaleziono"));
    return;
  }
  for (const mp of modpackResults) {
    list.appendChild(resultItem(mp, () => runModpackInstall(() => window.api.installModpack({ id: mp.id })), "modpacks-hint"));
  }
}

// Wspólne dla Modrinth i pliku z dysku; install() zwraca null, gdy gracz zrezygnował
async function runModpackInstall(install) {
  if (modpackInstalling) throw new Error("Poczekaj, aż skończy się instalacja poprzedniego modpacka");
  modpackInstalling = true;
  $("modpacks-progress").hidden = false;
  $("modpacks-bar").style.width = "0%";
  try {
    const info = await install();
    if (!info) return "";
    await loadVersions(`${info.gameVersion}|mp:${info.slug}`);
    await loadModpacks();
    const missing = info.missing
      ? ` Uwaga: ${info.missing} modów trzeba pobrać ręcznie z CurseForge (lista w konsoli launchera).`
      : "";
    return `Zainstalowano ${info.title} (Minecraft ${info.gameVersion}) — wybrany na liście wersji, kliknij „Graj”.${missing}`;
  } finally {
    modpackInstalling = false;
    $("modpacks-progress").hidden = true;
  }
}

$("btn-modpacks-import").onclick = async () => {
  try {
    $("modpacks-hint").textContent = await runModpackInstall(() => window.api.importModpack());
  } catch (err) {
    $("modpacks-hint").textContent = cleanError(err);
  }
};

async function loadModpacks() {
  try { playData = await window.api.getPlaytime(); } catch {}
  modpacksInstalled = await window.api.listModpacks();
  renderModpacks();
}

async function searchModpacks() {
  const seq = ++modpacksSeq;
  modpackResults = null;
  renderModpacks();
  try {
    const results = await window.api.searchModpacks({ query: $("modpacks-search").value.trim() });
    if (seq === modpacksSeq) modpackResults = results;
  } catch {
    if (seq === modpacksSeq) modpackResults = [];
    $("modpacks-hint").textContent = "Nie udało się połączyć z Modrinth — sprawdź internet";
  }
  renderModpacks();
}

window.api.on("modpacks:progress", p => {
  const percent = p.total ? Math.round((p.task / p.total) * 100) : 0;
  $("modpacks-bar").style.width = `${percent}%`;
  $("modpacks-hint").textContent = `Pobieranie plików modpacka: ${p.task}/${p.total}`;
});

$("btn-modpacks").onclick = () => {
  $("modpacks-hint").textContent = "";
  $("modpacks-search").value = "";
  $("modpacks-list").scrollTop = 0;
  $("modpacks").hidden = false;
  loadModpacks();
  searchModpacks();
};
$("btn-close-modpacks").onclick = () => { $("modpacks").hidden = true; };

// ---------- Okno „Nowy profil” ----------

// Loadery działające na danej wersji gry
function profileLoaders(version) {
  const list = [];
  if (loaderSets.fabric.has(version)) list.push("fabric");
  if (loaderSets.forge.has(version) || loaderSets.oldForge[version]) list.push("forge");
  if (loaderSets.neoforge.has(version)) list.push("neoforge");
  list.push("vanilla");
  return list;
}

// Paczka xBobersonx istnieje dla: Fabric (każda wersja), Forge (1.8.9 i 1.20+), NeoForge
function profileHasPack(version, loader) {
  if (loader === "vanilla") return false;
  if (loader === "forge") return !!loaderSets.oldForge[version] || loaderSets.forge.has(version);
  return true;
}

function fillProfileLoaders() {
  const version = $("profile-version").value;
  const select = $("profile-loader");
  const previous = select.value;
  select.innerHTML = "";
  for (const loader of profileLoaders(version)) {
    const opt = document.createElement("option");
    opt.value = loader;
    opt.textContent = loader === "vanilla" ? "Bez modów (czysty Minecraft)" : LOADER_NAMES[loader];
    select.appendChild(opt);
  }
  // 1.8.9 najczęściej gra się na Forge (paczka PvP)
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
  else if (loaderSets.oldForge[version]) select.value = "forge";
  updateProfilePack();
}

function updateProfilePack() {
  const version = $("profile-version").value, loader = $("profile-loader").value;
  const available = profileHasPack(version, loader);
  $("profile-pack").disabled = !available;
  if (!available) $("profile-pack").checked = false;
  const pvp = loader === "forge" && loaderSets.oldForge[version];
  $("profile-pack-label").textContent = available
    ? `Z paczką modów ${pvp || loaderSets.packName || "xBobersonx"}`
    : "Z paczką modów (niedostępna dla tego wyboru)";
}

let profileEditing = null; // edytowany profil albo null przy tworzeniu nowego

$("btn-profile-new").onclick = () => openProfileDialog(null);

function openProfileDialog(existing) {
  profileEditing = existing;
  const select = $("profile-version");
  select.innerHTML = "";
  for (const v of loaderSets.versions) {
    if (v.type !== "release") continue;
    const opt = document.createElement("option");
    opt.value = v.id;
    opt.textContent = `Minecraft ${v.id}`;
    select.appendChild(opt);
  }
  if (!select.options.length) {
    $("modpacks-hint").textContent = "Brak listy wersji — sprawdź internet";
    return;
  }
  fillProfileLaunch(existing);
  $("profile-title").textContent = existing ? `Edytuj profil — ${existing.title}` : "Nowy profil";
  $("btn-profile-create").textContent = existing ? "Zapisz" : "Utwórz";
  $("profile-name").value = existing ? existing.title : "";
  $("profile-hint").textContent = "";
  if (existing) {
    // wersja profilu może być spoza listy (np. bez internetu) — dodajemy ją, żeby nie zniknęła
    if (![...select.options].some(o => o.value === existing.gameVersion)) {
      const opt = document.createElement("option");
      opt.value = existing.gameVersion;
      opt.textContent = `Minecraft ${existing.gameVersion}`;
      select.prepend(opt);
    }
    select.value = existing.gameVersion;
    $("profile-loader").innerHTML = "";
    fillProfileLoaders();
    if ([...$("profile-loader").options].some(o => o.value === existing.loader)) $("profile-loader").value = existing.loader;
    updateProfilePack();
    $("profile-pack").checked = !!existing.pack && !$("profile-pack").disabled;
  } else {
    $("profile-pack").checked = true;
    fillProfileLoaders();
  }
  $("profile-new").hidden = false;
  $("profile-name").focus();
}

// RAM, Java i argumenty profilu (puste = jak w ustawieniach launchera)
let profileJava = null;
function fillProfileLaunch(existing) {
  const ram = $("profile-ram");
  ram.innerHTML = "";
  const global = Number($("ram").value) || recommendedRam();
  const def = document.createElement("option");
  def.value = "";
  def.textContent = `Jak w ustawieniach (${global} GB)`;
  ram.appendChild(def);
  const max = Math.max(2, systemRam);
  for (let gb = 1; gb <= max; gb++) {
    const opt = document.createElement("option");
    opt.value = String(gb);
    opt.textContent = `${gb} GB${gb === recommendedRam() ? " (zalecane)" : ""}${max - gb < 2 ? " — mało zostanie dla Windowsa" : ""}`;
    ram.appendChild(opt);
  }
  if (existing && existing.ram && existing.ram > max) {
    const opt = document.createElement("option");
    opt.value = String(existing.ram);
    opt.textContent = `${existing.ram} GB`;
    ram.appendChild(opt);
  }
  ram.value = existing && existing.ram ? String(existing.ram) : "";
  $("profile-args").value = (existing && existing.javaArgs) || "";
  setProfileJava(existing && existing.javaPath ? { path: existing.javaPath, version: null } : null);
  if (existing && existing.javaPath) {
    window.api.javaVersion({ path: existing.javaPath }).then(version => {
      if (profileJava && profileJava.path === existing.javaPath) setProfileJava({ path: existing.javaPath, version });
    }).catch(() => {});
  }
  // rozwinięte, gdy profil ma coś ustawione
  $("profile-advanced").open = !!(existing && (existing.ram || existing.javaArgs || existing.javaPath));
}
function setProfileJava(java) {
  profileJava = java;
  const label = $("profile-java-label");
  if (!java) {
    label.textContent = "Automatycznie (launcher pobiera właściwą)";
    label.title = "";
  } else {
    label.textContent = `${java.version ? `Java ${java.version} — ` : ""}${java.path}`;
    label.title = java.path;
  }
  $("btn-profile-java-auto").hidden = !java;
}
$("btn-profile-java").onclick = async () => {
  try {
    const java = await window.api.pickJava();
    if (java) setProfileJava(java);
    $("profile-hint").textContent = java && !java.version ? "Nie udało się sprawdzić wersji tej Javy — gra może się nie uruchomić" : "";
  } catch (err) {
    $("profile-hint").textContent = cleanError(err);
  }
};
$("btn-profile-java-auto").onclick = () => setProfileJava(null);

// Ostrzeżenie przy edycji: inna wersja albo loader psuje własne mody, wyłączenie paczki usuwa jej mody
function profileWarning() {
  const e = profileEditing;
  if (!e) return "";
  const version = $("profile-version").value, loader = $("profile-loader").value;
  const pack = $("profile-pack").checked && !$("profile-pack").disabled;
  const notes = [];
  if (version !== e.gameVersion || loader !== e.loader) {
    notes.push("Twoje własne mody mogą nie działać na innej wersji albo loaderze. Światy z nowszej wersji mogą nie otworzyć się na starszej.");
  }
  if (e.pack && (!pack || version !== e.gameVersion || loader !== e.loader)) {
    notes.push(pack ? "Mody paczki zostaną pobrane od nowa dla nowej wersji." : "Mody paczki zostaną usunięte z profilu.");
  }
  return notes.join(" ");
}
const refreshProfileWarning = () => { $("profile-hint").textContent = profileWarning(); };
$("profile-version").onchange = () => { fillProfileLoaders(); refreshProfileWarning(); };
$("profile-loader").onchange = () => { updateProfilePack(); refreshProfileWarning(); };
$("profile-pack").onchange = refreshProfileWarning;
const closeProfile = () => { $("profile-new").hidden = true; };
$("btn-close-profile").onclick = closeProfile;
$("btn-profile-cancel").onclick = closeProfile;
$("profile-form").onsubmit = async event => {
  event.preventDefault();
  const button = $("btn-profile-create");
  button.disabled = true;
  try {
    const options = {
      name: $("profile-name").value,
      gameVersion: $("profile-version").value,
      loader: $("profile-loader").value,
      pack: $("profile-pack").checked && !$("profile-pack").disabled,
      ram: $("profile-ram").value ? Number($("profile-ram").value) : null,
      javaArgs: $("profile-args").value.trim(),
      javaPath: profileJava ? profileJava.path : null,
    };
    const editing = profileEditing;
    const info = editing
      ? await window.api.updateProfile({ slug: editing.slug, ...options })
      : await window.api.createProfile(options);
    closeProfile();
    // edycja nie przestawia wybranej wersji, chyba że wybrany był właśnie ten profil
    const current = $("version").value;
    const wasSelected = editing && current === `${editing.gameVersion}|mp:${editing.slug}`;
    await loadVersions(!editing || wasSelected ? `${info.gameVersion}|mp:${info.slug}` : undefined);
    await loadModpacks();
    $("modpacks-hint").textContent = editing
      ? `Zapisano profil ${info.title}`
      : `Utworzono profil ${info.title} — wybrany na liście wersji, kliknij „Graj”`;
  } catch (err) {
    $("profile-hint").textContent = cleanError(err);
  } finally {
    button.disabled = false;
  }
};
$("modpacks-search").oninput = () => {
  clearTimeout(modpacksTimer);
  modpacksTimer = setTimeout(searchModpacks, 400);
};

// ---------- Serwery ----------

const serverInfo = new Map(); // adres → wynik pingu albo { error }

const savedServers = () => settings.servers || (settings.servers = []);

function saveServers() {
  window.api.saveSettings(settings);
}

function serverRow(srv, index) {
  const info = serverInfo.get(srv.address);
  const li = document.createElement("li");
  li.className = "result";
  const icon = document.createElement("img");
  icon.className = "result-icon";
  icon.src = info && info.favicon ? info.favicon : "assets/icon.png";
  icon.alt = "";
  const body = document.createElement("div");
  body.className = "result-body";

  const title = document.createElement("div");
  title.className = "result-title";
  title.textContent = `${srv.name} `;
  const addr = document.createElement("small");
  addr.textContent = srv.address;
  title.appendChild(addr);
  if (info && !info.error) {
    const tag = document.createElement("span");
    const kind = info.premium || "unknown";
    tag.className = `server-tag ${kind}`;
    tag.textContent = { cracked: "non-premium ✓", premium: "tylko premium", unknown: "premium?" }[kind];
    tag.title = {
      cracked: "Serwer wpuszcza graczy bez konta Microsoft",
      premium: "Serwer wymaga konta Microsoft z kupionym Minecraftem",
      unknown: "Nie udało się sprawdzić, czy serwer wpuszcza graczy non-premium",
    }[kind];
    title.appendChild(tag);
  }

  const desc = document.createElement("div");
  desc.className = "result-desc motd";
  const meta = document.createElement("div");
  meta.className = "result-meta";
  const dot = document.createElement("span");
  dot.className = "server-dot";
  if (!info) {
    desc.textContent = "Sprawdzanie…";
  } else if (info.error) {
    dot.classList.add("off");
    desc.textContent = info.error;
  } else {
    dot.classList.add("on");
    desc.textContent = info.motd || "";
    const parts = [];
    if (info.players != null) parts.push(`${info.players}/${info.max} graczy`);
    if (info.ping !== null) parts.push(`${info.ping} ms`);
    if (info.version) parts.push(info.version);
    meta.textContent = parts.join(" · ");
  }
  meta.prepend(dot);
  body.append(title, desc, meta);

  const buttons = document.createElement("div");
  buttons.className = "result-buttons";
  const play = document.createElement("button");
  play.className = "primary";
  play.textContent = "Graj";
  play.disabled = $("btn-play").disabled;
  play.onclick = () => joinServer(srv, info);
  const del = document.createElement("button");
  del.textContent = "✕";
  del.title = "Usuń z listy";
  del.onclick = () => {
    savedServers().splice(index, 1);
    saveServers();
    renderServers();
  };
  buttons.append(play, del);
  li.append(icon, body, buttons);
  return li;
}

function renderServers() {
  const list = $("servers-list");
  list.innerHTML = "";
  const all = savedServers();
  if (all.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "Dodaj serwer: wpisz nazwę i adres na górze";
    list.appendChild(li);
    return;
  }
  all.forEach((srv, i) => list.appendChild(serverRow(srv, i)));
}

async function pingServer(address) {
  serverInfo.delete(address);
  renderServers();
  try {
    serverInfo.set(address, await window.api.pingServer(address));
  } catch (err) {
    serverInfo.set(address, { error: cleanError(err) });
  }
  renderServers();
}

const pingAll = () => savedServers().forEach(srv => pingServer(srv.address));

function joinServer(srv, info) {
  if (info && info.premium === "premium" && !premiumAccount) {
    $("servers-hint").textContent = `${srv.name} wpuszcza tylko konta premium — zaloguj się przez Microsoft w ⚙ → Konto`;
    return;
  }
  $("servers").hidden = true;
  startGame(srv.address);
}

$("btn-servers").onclick = () => {
  $("servers-hint").textContent = "Gra uruchomi się na wersji wybranej w launcherze i od razu wejdzie na serwer.";
  $("servers").hidden = false;
  pingAll();
};
$("btn-close-servers").onclick = () => { $("servers").hidden = true; };
$("btn-servers-refresh").onclick = pingAll;
$("servers-add").onsubmit = e => {
  e.preventDefault();
  const address = $("server-address").value.trim().replace(/^minecraft:\/\//i, "").replace(/\/+$/, "");
  if (!/^[\w.\-\[\]:]+$/.test(address)) {
    $("servers-hint").textContent = "Wpisz adres serwera, np. mc.serwer.pl albo 123.45.67.89:25565";
    return;
  }
  if (savedServers().some(srv => srv.address.toLowerCase() === address.toLowerCase())) {
    $("servers-hint").textContent = "Ten serwer już jest na liście";
    return;
  }
  savedServers().push({ name: $("server-name").value.trim() || address, address });
  saveServers();
  $("server-name").value = "";
  $("server-address").value = "";
  $("servers-hint").textContent = "";
  pingServer(address);
};

// ---------- Własne tło ----------

// url = data URL własnego obrazu albo null dla domyślnego tła
function setBackground(url) {
  $("bg-img").src = url || "assets/background.png";
  $("bg-preview").src = url || "assets/background.png";
  $("bg-name").textContent = url ? "Własny obraz" : "Domyślne";
  $("btn-bg-reset").hidden = !url;
}

$("btn-bg-choose").onclick = async () => {
  const url = await window.api.chooseBackground();
  if (url) setBackground(url);
};
$("btn-bg-reset").onclick = async () => {
  await window.api.resetBackground();
  setBackground(null);
};
window.api.getBackground().then(url => setBackground(url));

// Język: angielski domyślnie, polski do wyboru (tłumaczy i18n.js)
$("lang").value = I18N.lang;
window.api.setLang(I18N.lang);
$("lang").onchange = () => {
  const lang = $("lang").value;
  try { localStorage.setItem("lang", lang); } catch {}
  I18N.apply(lang);
  window.api.setLang(lang);
};

// Boczny pasek: jedno okno naraz, podświetlony przycisk otwartego okna
const PAGES = { "btn-modpacks": "modpacks", "btn-mods": "mods", "btn-servers": "servers", "btn-settings": "settings" };
const overlays = [...document.querySelectorAll(".overlay")];
function closeOverlays() {
  overlays.forEach(o => { o.hidden = true; });
  $("account-menu").hidden = true;
}
function syncSidebar() {
  let active = "btn-home";
  for (const [btn, page] of Object.entries(PAGES)) if (!$(page).hidden) active = btn;
  if (!$("disk").hidden) active = "btn-settings";
  const settingsPage = document.querySelector(".nav-item.active");
  if (active === "btn-settings" && settingsPage && settingsPage.dataset.page === "account") active = "btn-account";
  document.querySelectorAll(".side-btn").forEach(b => b.classList.toggle("active", b.id === active));
  // nazwa otwartej zakładki w pasku tytułu (podpis przycisku jest już przetłumaczony)
  const tip = $(active).querySelector(".tip");
  if (tip) $("page-title").textContent = tip.textContent;
}
$("sidebar").addEventListener("click", e => { if (e.target.closest(".side-btn")) closeOverlays(); }, true);
$("btn-home").onclick = closeOverlays;
$("btn-account").onclick = () => showSettingsPage("account");
new MutationObserver(syncSidebar).observe(document.body, { subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });

// ---------- Home: pasek tytułu, data, skróty ----------
$("tb-settings").onclick = () => { closeOverlays(); $("btn-settings").click(); };
$("tb-search").onclick = () => {
  closeOverlays();
  $("btn-mods").click();
  setTimeout(() => $("mods-search").focus(), 50);
};
$("home-accounts").onclick = () => showSettingsPage("account");
$("home-logout").onclick = () => $("btn-logout").click();
$("servers-all").onclick = () => $("btn-servers").click();

function showDate() {
  const locale = I18N.lang === "pl" ? "pl-PL" : "en-GB";
  $("home-date").textContent = new Date().toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "short" }).replace(/\.$/, ""); // „lis.” → „lis”
}
showDate();
$("lang").addEventListener("change", showDate);

// Własny pasek tytułu (okno bez ramki). Przy frame: false Windows sam nie maksymalizuje okna
// po podwójnym kliknięciu, więc robi to launcher.
$("win-min").onclick = () => window.api.minimizeWindow();
$("win-max").onclick = () => window.api.toggleMaximizeWindow();
$("win-close").onclick = () => window.api.closeWindow();
$("titlebar").addEventListener("dblclick", e => {
  if (!e.target.closest(".window-controls")) window.api.toggleMaximizeWindow();
});
function showMaximized(maximized) {
  document.body.classList.toggle("maximized", maximized);
  $("win-max").title = maximized ? "Przywróć" : "Maksymalizuj";
}
window.api.on("window:maximized", showMaximized);
window.api.isWindowMaximized().then(showMaximized);

init();
