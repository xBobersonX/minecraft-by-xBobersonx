const { app, BrowserWindow, ipcMain, shell, safeStorage, Tray, Menu, net, dialog, nativeImage } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { Client, Authenticator } = require("minecraft-launcher-core");
const { Auth } = require("msmc");
const { autoUpdater } = require("electron-updater");
const AdmZip = require("adm-zip");
const {
  installPack, removePack, packName, forgePack, packFor, packModsDir, listMods, setModEnabled, searchMods, installOwnMod, checkOwnUpdates, updateOwnMod,
} = require("./modpack");
const mrpack = require("./mrpack");
const { getJava, JVM_FLAGS } = require("./java");
const content = require("./content");
const { analyze, findCrashReport, stackSuspects } = require("./crash");
const disk = require("./disk");
const gameOptions = require("./options");
const sharedFiles = require("./shared");
const servers = require("./servers");
const I18N = require("./i18n");
const t = I18N.t;

const ICON = path.join(__dirname, "assets", "icon.png");

// Domyślne ustawienia graficzne dla nowej wersji (tylko gdy gra nie ma jeszcze options.txt)
// Ustawienia startowe nowych graczy (klawisze, grafika, język). Zawiera numer wersji — bez niego gra by ich nie wczytała.
const DEFAULT_OPTIONS = path.join(__dirname, "default-options.txt");

// Dane okna (w tym klucz szyfrujący zapisane konta) zostają w starym folderze mimo zmiany nazwy na BobrMC
app.setPath("userData", path.join(app.getPath("appData"), "minecraft-by-xbobersonx"));

const GAME_DIR = path.join(app.getPath("appData"), ".minecraft_by_xbobersonx");
const SETTINGS_FILE = path.join(GAME_DIR, "launcher_settings.json");
const ACCOUNTS_FILE = path.join(GAME_DIR, "accounts.dat");
const OLD_ACCOUNT_FILE = path.join(GAME_DIR, "account.dat");
const OLD_PROFILE_FILE = path.join(GAME_DIR, "account-profile.json");
const SHARED_OPTIONS = path.join(GAME_DIR, "shared-options.txt");
const MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_META = "https://meta.fabricmc.net/v2/versions/loader";
const FORGE_MAVEN = "https://maven.minecraftforge.net/";

let win;
let tray = null;
let gameRunning = false;
let msMinecraft = null; // zalogowane konto Microsoft (obiekt Minecraft z msmc)

// Wiadomość do okna launchera (pomijana, jeśli okno jest już zamknięte)
const send = (channel, data) => win && !win.isDestroyed() && win.webContents.send(channel, data);

// Na czas gry launcher chowa się do zasobnika (obok zegara) i wraca po zamknięciu gry
function hideToTray() {
  if (!win || win.isDestroyed()) return;
  if (!tray) {
    tray = new Tray(ICON);
    tray.setToolTip(t("BobrMC — gra działa"));
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: t("Pokaż launcher"), click: showFromTray },
      { label: t("Zamknij launcher"), click: () => app.quit() },
    ]));
    tray.on("click", showFromTray);
  }
  win.hide();
}

function showFromTray() {
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
  }
}

// Automatyczne aktualizacje z GitHub Releases (tylko w zainstalowanej wersji;
// wersja portable i uruchomienie przez npm start ich nie obsługują)
function setupAutoUpdate() {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", info => send("update:available", info.version));
  autoUpdater.on("download-progress", p => send("update:progress", Math.round(p.percent)));
  autoUpdater.on("update-downloaded", info => send("update:ready", info.version));
  autoUpdater.on("error", err => console.error("Aktualizacja:", err.message));
  autoUpdater.checkForUpdates().catch(err => console.error("Aktualizacja:", err.message));
}

ipcMain.handle("update:install", () => autoUpdater.quitAndInstall());

// Ręczne sprawdzenie aktualizacji z ustawień — zwraca tekst do pokazania
ipcMain.handle("update:check", async () => {
  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) {
    return "Automatyczne aktualizacje działają tylko w wersji zainstalowanej z instalatora (Setup.exe).";
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const latest = result && result.updateInfo ? result.updateInfo.version : null;
    if (!latest || latest === app.getVersion()) return `Masz najnowszą wersję (${app.getVersion()}).`;
    return `Jest nowa wersja ${latest} — pobieranie w tle, pasek u góry pokaże, kiedy będzie gotowa.`;
  } catch (err) {
    return `Nie udało się sprawdzić aktualizacji: ${err.message}`;
  }
});

// Przyciski okna z własnego paska tytułu
ipcMain.on("window:minimize", () => win && win.minimize());
ipcMain.on("window:toggle-maximize", () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize();
  else win.maximize();
});
ipcMain.on("window:close", () => win && win.close());
ipcMain.handle("window:is-maximized", () => Boolean(win && win.isMaximized()));
ipcMain.on("lang:set", (_e, lang) => I18N.setLang(lang));
ipcMain.handle("open:github", () => shell.openExternal("https://github.com/kubkuster-cloud/minecraft-by-xBobersonx"));

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 780,
    minWidth: 1100,
    minHeight: 680,
    title: "BobrMC",
    backgroundColor: "#0b0d12",
    // okno bez ramki: pasek tytułu i przyciski okna rysuje launcher (index.html)
    frame: false,
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
    },
  });
  win.setMenu(null);
  const sendMaximized = () => send("window:maximized", win.isMaximized());
  win.on("maximize", sendMaximized);
  win.on("unmaximize", sendMaximized);
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.once("did-finish-load", setupAutoUpdate);
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
  } catch {
    return {}; // pierwsze uruchomienie — RAM ustawi się na „Zalecane”
  }
}

function saveSettings(settings) {
  fs.mkdirSync(GAME_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

ipcMain.handle("settings:load", () => loadSettings());
ipcMain.handle("settings:save", (_e, s) => saveSettings(s));
ipcMain.handle("system:ram", () => Math.floor(os.totalmem() / 1024 ** 3));

// ---------- Tryb offline ----------

// Pobiera JSON i zapisuje kopię; bez internetu zwraca ostatnią zapisaną kopię
async function cachedJson(url, name) {
  const file = path.join(GAME_DIR, "cache", "launcher", `${name}.json`);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
    return { data, offline: false };
  } catch (err) {
    if (!fs.existsSync(file)) throw err;
    return { data: JSON.parse(fs.readFileSync(file, "utf8")), offline: true };
  }
}

// ---------- Dane dla ekranu Home ----------
const HOME_UA = { "User-Agent": "BobrMC-launcher" };
const PLAYTIME_FILE = path.join(GAME_DIR, "playtime.json");
const NEWS_REPO = "kubkuster-cloud/minecraft-by-xBobersonx";

// Plik JSON z cache launchera; zły albo brak = fallback
function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
}

// Skin jako data URL (okno nie łączy się z internetem samo). Konto Microsoft podaje adres skina,
// dla nicku pytamy Mojang, czy taki gracz istnieje. Wynik trzymamy 6 h, bez internetu — ostatni zapisany.
ipcMain.handle("skin:get", async (_e, { nick, url }) => {
  const key = (url ? "url-" + url.split("/").pop() : "nick-" + String(nick || "").toLowerCase()).replace(/[^\w.-]/g, "_");
  const cacheFile = path.join(GAME_DIR, "cache", "skins", key + ".json");
  const cached = readJson(cacheFile, null);
  if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) return cached.skin;
  try {
    let skinUrl = url, slim = false;
    if (!skinUrl) {
      if (!/^[A-Za-z0-9_]{3,16}$/.test(nick || "")) return null;
      const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${nick}`, { headers: HOME_UA });
      if (res.status === 404 || res.status === 204) {
        writeJson(cacheFile, { at: Date.now(), skin: null });
        return null;
      }
      const { id } = await res.json();
      const profile = await (await fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`, { headers: HOME_UA })).json();
      const textures = JSON.parse(Buffer.from(profile.properties.find(p => p.name === "textures").value, "base64").toString());
      const skin = textures.textures && textures.textures.SKIN;
      if (!skin) return null;
      skinUrl = skin.url;
      slim = !!(skin.metadata && skin.metadata.model === "slim");
    }
    if (!/^https?:\/\/textures\.minecraft\.net\//.test(skinUrl)) return null;
    const png = Buffer.from(await (await fetch(skinUrl.replace(/^http:/, "https:"), { headers: HOME_UA })).arrayBuffer());
    const result = { data: "data:image/png;base64," + png.toString("base64"), slim };
    writeJson(cacheFile, { at: Date.now(), skin: result });
    return result;
  } catch {
    return cached ? cached.skin : null;
  }
});

// Ostatnie wydania launchera z GitHub Releases (Co nowego). Bez internetu — ostatnio pobrane.
ipcMain.handle("news:get", async () => {
  const cacheFile = path.join(GAME_DIR, "cache", "launcher", "news.json");
  try {
    const res = await fetch(`https://api.github.com/repos/${NEWS_REPO}/releases?per_page=5`, {
      headers: { ...HOME_UA, Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(String(res.status));
    const items = (await res.json())
      .filter(r => !r.draft)
      .slice(0, 5)
      .map(r => ({ tag: r.tag_name, title: r.name || r.tag_name, body: r.body || "", date: r.published_at, url: r.html_url }));
    writeJson(cacheFile, items);
    return { items, offline: false };
  } catch {
    return { items: readJson(cacheFile, []), offline: true };
  }
});

// Otwiera stronę wydania w przeglądarce — tylko adresy z repozytorium launchera
ipcMain.handle("open:release", (_e, url) => {
  if (typeof url === "string" && url.startsWith(`https://github.com/${NEWS_REPO}/`)) shell.openExternal(url);
});

// Czas gry na każdej wersji i ostatnie uruchomienia (szybki start)
ipcMain.handle("home:playtime", () => readJson(PLAYTIME_FILE, { versions: {}, history: [] }));

function recordPlay(entry, seconds) {
  const data = readJson(PLAYTIME_FILE, { versions: {}, history: [] });
  data.versions[entry.key] = (data.versions[entry.key] || 0) + Math.max(0, Math.round(seconds));
  const same = h => h.key === entry.key && (h.server || null) === (entry.server || null) && (h.world || null) === (entry.world || null);
  data.history = [entry, ...data.history.filter(h => !same(h))].slice(0, 12);
  writeJson(PLAYTIME_FILE, data);
}

// Światy wersji (do szybkiego startu): nazwa folderu, nazwa świata, czas ostatniej gry, ikona
ipcMain.handle("home:worlds", (_e, { version, instance }) => {
  const saves = path.join(instanceDir(version, instance), "saves");
  if (!fs.existsSync(saves)) return [];
  return fs.readdirSync(saves, { withFileTypes: true })
    .filter(d => d.isDirectory() && fs.existsSync(path.join(saves, d.name, "level.dat")))
    .map(d => {
      const dir = path.join(saves, d.name);
      const icon = path.join(dir, "icon.png");
      return {
        folder: d.name,
        at: fs.statSync(path.join(dir, "level.dat")).mtimeMs,
        icon: fs.existsSync(icon) && fs.statSync(icon).size < 200000 ? "data:image/png;base64," + fs.readFileSync(icon).toString("base64") : null,
      };
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, 6);
});

// Wersje, które były już uruchomione (mają pobraną paczkę) — tylko na nich da się grać bez internetu
function installedVersions() {
  const dir = path.join(GAME_DIR, "instances");
  if (!fs.existsSync(dir)) return [];
  // "1.21.11" = paczka Fabric (albo stary Forge), "forge:1.20.1" = paczka na nowym Forge
  return fs.readdirSync(dir)
    .filter(n => /^(pack|forge|neoforge)-/.test(n) && fs.existsSync(path.join(dir, n, ".xbobersonx-pack.json")))
    .map(n => n.startsWith("pack-") ? n.slice("pack-".length) : n.replace(/^(forge|neoforge)-/, "$1:"));
}

ipcMain.handle("versions:list", async () => {
  const { data, offline } = await cachedJson(MANIFEST_URL, "version_manifest");
  return {
    latest: data.latest,
    versions: data.versions.map(v => ({ id: v.id, type: v.type })),
    offline,
    installed: installedVersions(),
    modpacks: mrpack.listModpacks(GAME_DIR),
  };
});

// Pobiera profil Fabric dla danej wersji gry i zapisuje go w versions/,
// zwraca jego id (np. "fabric-loader-0.16.10-1.21.1") do użycia jako version.custom.
// Bez internetu używa wcześniej zapisanego profilu.
// loaderVersion: konkretna wersja Fabric Loadera (modpacki jej wymagają); bez niej — najnowsza stabilna
async function installFabric(gameVersion, loaderVersion) {
  try {
    let loader = loaderVersion;
    if (!loader) {
      const res = await fetch(`${FABRIC_META}/${gameVersion}`);
      const loaders = await res.json();
      if (!Array.isArray(loaders) || loaders.length === 0) {
        throw new Error(`Fabric nie jest dostępny dla wersji ${gameVersion}`);
      }
      loader = (loaders.find(l => l.loader.stable) || loaders[0]).loader.version;
    }

    const profileRes = await fetch(`${FABRIC_META}/${gameVersion}/${loader}/profile/json`);
    if (!profileRes.ok) throw new Error(`Fabric: ${profileRes.status}`);
    const profile = await profileRes.json();
    const dir = path.join(GAME_DIR, "versions", profile.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${profile.id}.json`), JSON.stringify(profile, null, 2));
    return profile.id;
  } catch (err) {
    const versionsDir = path.join(GAME_DIR, "versions");
    const wanted = loaderVersion ? `fabric-loader-${loaderVersion}-${gameVersion}` : null;
    const saved = fs.existsSync(versionsDir)
      ? fs.readdirSync(versionsDir)
          .filter(n => n.startsWith("fabric-loader-") && n.endsWith(`-${gameVersion}`))
          .filter(n => !wanted || n === wanted)
          .filter(n => fs.existsSync(path.join(versionsDir, n, `${n}.json`)))
          .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      : [];
    if (saved.length === 0) throw new Error(`Brak internetu — wersję ${gameVersion} trzeba raz uruchomić z internetem`);
    return saved[saved.length - 1];
  }
}

// Stary Forge (1.8.9) uruchamiany przez minecraft-launcher-core z pliku „universal”.
// Plik leży w libraries/ jak każda biblioteka; bez internetu używamy już pobranego.
async function installForge(build) {
  const rel = `net/minecraftforge/forge/${build}/forge-${build}-universal.jar`;
  const file = path.join(GAME_DIR, "libraries", ...rel.split("/"));
  if (fs.existsSync(file)) return file;
  let res;
  try {
    res = await fetch(FORGE_MAVEN + rel);
  } catch {
    throw new Error("Brak internetu — Forge trzeba raz pobrać z internetem");
  }
  if (!res.ok) throw new Error(`Nie udało się pobrać Forge ${build} (${res.status})`);
  const data = Buffer.from(await res.arrayBuffer());
  // urwane pobieranie dałoby uszkodzony plik, przez który gra się nie uruchomi
  let valid = false;
  try { valid = !!new AdmZip(data).getEntry("version.json"); } catch {}
  if (!valid) throw new Error("Uszkodzony plik Forge — spróbuj ponownie");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return file;
}

// ---------- Nowy Forge (1.20 i wyżej) ----------
// Od 1.13 Forge nie ma gotowego pliku „universal”: instalator musi raz przerobić pliki gry.
// Uruchamiamy go w tle (java -jar installer --installClient), a on zapisuje profil versions/<mc>-forge-<build>/,
// który minecraft-launcher-core uruchamia jak każdy własny profil (version.custom).
const FORGE_PROMOS = "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json";

function forgeModernFrom() {
  return (require("./modpack.json").forgeModern || {}).from || null;
}

function versionAtLeast(version, min) {
  const a = String(version).split(".").map(Number), b = String(min).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

// { "1.20.1": "47.4.28", ... } — zalecany build, a bez niego najnowszy; tylko wersje od „from”
async function modernForgeBuilds() {
  const from = forgeModernFrom();
  if (!from) return {};
  const { data } = await cachedJson(FORGE_PROMOS, "forge_promotions");
  const builds = {};
  for (const [key, build] of Object.entries(data.promos || {})) {
    const m = /^(\d+\.\d+(?:\.\d+)?)-(recommended|latest)$/.exec(key);
    if (!m || !versionAtLeast(m[1], from)) continue;
    if (m[2] === "recommended" || !builds[m[1]]) builds[m[1]] = build;
  }
  return builds;
}

ipcMain.handle("forge:modern", async () => {
  try { return Object.keys(await modernForgeBuilds()); } catch { return []; }
});

// ---------- NeoForge ----------
// Instaluje się tym samym sposobem co Forge (ten sam instalator, opcja --installClient), profil to neoforge-<build>.
// Numer NeoForge zawiera wersję gry: 21.1.268 = Minecraft 1.21.1, 21.0.x = 1.21, 26.1.2.130 = 26.1.2.
const NEOFORGE_MAVEN = "https://maven.neoforged.net/releases/";
const NEOFORGE_META = `${NEOFORGE_MAVEN}net/neoforged/neoforge/maven-metadata.xml`;

function neoforgeGameVersion(build) {
  const parts = build.split("-")[0].split(".");
  if (parts.some(x => !/^\d+$/.test(x))) return null;
  const [a, b, c] = parts;
  if (Number(a) >= 26) return parts.length >= 4 ? `${a}.${b}${c !== "0" ? `.${c}` : ""}` : null;
  return parts.length === 3 ? `1.${a}${b !== "0" ? `.${b}` : ""}` : null;
}

// { "1.21.1": "21.1.268", ... } — najnowszy stabilny build (bez -beta) każdej wersji gry
async function neoforgeBuilds() {
  const cache = path.join(GAME_DIR, "cache", "launcher", "neoforge_versions.json");
  let versions;
  try {
    const res = await fetch(NEOFORGE_META);
    if (!res.ok) throw new Error(`${res.status}`);
    versions = [...(await res.text()).matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]);
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify(versions));
  } catch (err) {
    if (!fs.existsSync(cache)) throw err;
    versions = JSON.parse(fs.readFileSync(cache, "utf8"));
  }
  const from = (require("./modpack.json").neoforgeModern || {}).from || "1.20.2";
  const builds = {};
  for (const build of versions) {
    if (build.includes("-")) continue; // -beta i inne niestabilne
    const mc = neoforgeGameVersion(build);
    if (!mc || !versionAtLeast(mc, from)) continue;
    if (!builds[mc] || build.localeCompare(builds[mc], undefined, { numeric: true }) > 0) builds[mc] = build;
  }
  return builds;
}

ipcMain.handle("neoforge:versions", async () => {
  try { return Object.keys(await neoforgeBuilds()); } catch { return []; }
});

// Forge i NeoForge różnią się tylko adresem instalatora i nazwą profilu
const FORGE_KINDS = {
  forge: {
    label: "Forge",
    builds: () => modernForgeBuilds(),
    id: (mc, build) => `${mc}-forge-${build}`,
    file: (mc, build) => `forge-${mc}-${build}-installer.jar`,
    url: (mc, build) => `${FORGE_MAVEN}net/minecraftforge/forge/${mc}-${build}/forge-${mc}-${build}-installer.jar`,
    saved: (mc, name) => name.startsWith(`${mc}-forge-`),
  },
  neoforge: {
    label: "NeoForge",
    builds: () => neoforgeBuilds(),
    id: (mc, build) => `neoforge-${build}`,
    file: (mc, build) => `neoforge-${build}-installer.jar`,
    url: (mc, build) => `${NEOFORGE_MAVEN}net/neoforged/neoforge/${build}/neoforge-${build}-installer.jar`,
    saved: (mc, name) => name.startsWith("neoforge-") && neoforgeGameVersion(name.slice("neoforge-".length)) === mc,
  },
};

// Znacznik zapisywany dopiero po udanej instalacji: instalator tworzy profil przed przerobieniem plików gry,
// więc sam profil po przerwanej instalacji (zamknięty launcher) nie znaczy, że Forge działa
const FORGE_DONE = ".bobrmc-installed";

function savedForgeProfile(kind, gameVersion) {
  const dir = path.join(GAME_DIR, "versions");
  if (!fs.existsSync(dir)) return null;
  const saved = fs.readdirSync(dir)
    .filter(n => FORGE_KINDS[kind].saved(gameVersion, n) && fs.existsSync(path.join(dir, n, FORGE_DONE)))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return saved.length ? saved[saved.length - 1] : null;
}

// Instaluje (raz) Forge dla danej wersji gry i zwraca id profilu, np. "1.20.1-forge-47.4.28"
function fileSha1(file) {
  return require("crypto").createHash("sha1").update(fs.readFileSync(file)).digest("hex");
}

// Plik gry versions/<wersja>/<wersja>.jar ze sprawdzoną sumą (instalator Forge przerabia właśnie jego)
async function ensureVanillaJar(gameVersion) {
  const { data: manifest } = await cachedJson(MANIFEST_URL, "version_manifest");
  const entry = (manifest.versions || []).find(v => v.id === gameVersion);
  if (!entry) return;
  const dir = path.join(GAME_DIR, "versions", gameVersion);
  const jsonFile = path.join(dir, `${gameVersion}.json`);
  let version;
  try {
    version = JSON.parse(fs.readFileSync(jsonFile, "utf8"));
  } catch {
    const res = await fetch(entry.url);
    if (!res.ok) throw new Error(`Nie udało się pobrać danych wersji ${gameVersion} (${res.status})`);
    version = await res.json();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(jsonFile, JSON.stringify(version, null, 2));
  }
  const client = version.downloads && version.downloads.client;
  if (!client) return;
  const jar = path.join(dir, `${gameVersion}.jar`);
  if (fs.existsSync(jar) && fileSha1(jar) === client.sha1) return;
  send("game:log", `Pobieranie Minecrafta ${gameVersion}...`);
  const res = await fetch(client.url);
  if (!res.ok) throw new Error(`Nie udało się pobrać Minecrafta ${gameVersion} (${res.status})`);
  const data = Buffer.from(await res.arrayBuffer());
  if (require("crypto").createHash("sha1").update(data).digest("hex") !== client.sha1) {
    throw new Error(`Uszkodzony plik Minecrafta ${gameVersion} — spróbuj ponownie`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(jar, data);
}

// Usuwa biblioteki z instalatora, które leżą na dysku ze złą sumą kontrolną — instalator pobierze je od nowa
function dropBrokenLibraries(installer) {
  const zip = new AdmZip(installer);
  const libs = [];
  for (const name of ["install_profile.json", "version.json"]) {
    try { libs.push(...(JSON.parse(zip.readAsText(name)).libraries || [])); } catch {}
  }
  for (const lib of libs) {
    const art = lib.downloads && lib.downloads.artifact;
    if (!art || !art.path || !art.sha1) continue;
    const file = path.join(GAME_DIR, "libraries", ...art.path.split("/"));
    try {
      if (fs.existsSync(file) && fileSha1(file) !== art.sha1) {
        fs.rmSync(file, { force: true });
        send("game:log", `[forge] Usunięto uszkodzony plik ${path.basename(file)}`);
      }
    } catch {}
  }
}

// kind: "forge" albo "neoforge"; wantedBuild: konkretna wersja (modpacki jej wymagają), bez niej — zalecana
async function installForgeLoader(kind, gameVersion, javaPath, wantedBuild) {
  const k = FORGE_KINDS[kind];
  let build = wantedBuild;
  if (!build) {
    try {
      build = (await k.builds())[gameVersion];
    } catch {}
  }
  if (!build) {
    const saved = savedForgeProfile(kind, gameVersion);
    if (saved) return saved;
    throw new Error(`${k.label} nie jest dostępny dla wersji ${gameVersion} (albo brak internetu)`);
  }
  const id = k.id(gameVersion, build);
  if (fs.existsSync(path.join(GAME_DIR, "versions", id, FORGE_DONE))) return id;

  const full = `${k.label} ${kind === "forge" ? `${gameVersion}-${build}` : build}`;
  const installer = path.join(GAME_DIR, "cache", kind, k.file(gameVersion, build));
  if (!fs.existsSync(installer)) {
    send("game:log", `Pobieranie instalatora ${full}...`);
    let res;
    try {
      res = await fetch(k.url(gameVersion, build));
    } catch {
      throw new Error(`Brak internetu — ${k.label} trzeba raz zainstalować z internetem`);
    }
    if (!res.ok) throw new Error(`Nie udało się pobrać instalatora ${full} (${res.status})`);
    const data = Buffer.from(await res.arrayBuffer());
    let valid = false;
    try { valid = !!new AdmZip(data).getEntry("install_profile.json"); } catch {}
    if (!valid) throw new Error(`Uszkodzony instalator ${k.label} — spróbuj ponownie`);
    fs.mkdirSync(path.dirname(installer), { recursive: true });
    fs.writeFileSync(installer, data);
  }

  // instalator nie sprawdza plików, które już są na dysku — urwane po przerwanej instalacji psułyby każdą następną
  await ensureVanillaJar(gameVersion);
  dropBrokenLibraries(installer);

  // instalator wymaga pliku launchera Mojang w folderze docelowym
  const profiles = path.join(GAME_DIR, "launcher_profiles.json");
  if (!fs.existsSync(profiles)) fs.writeFileSync(profiles, JSON.stringify({ profiles: {} }, null, 2));

  send("game:log", `Instalowanie ${full} (pierwszy raz trwa 1–3 minuty)...`);
  // java.exe zamiast javaw.exe — instalator pisze postęp na konsolę
  const java = /javaw\.exe$/i.test(javaPath) ? javaPath.replace(/javaw\.exe$/i, "java.exe") : javaPath;
  const { spawn } = require("child_process");
  const tail = [];
  const code = await new Promise((resolve, reject) => {
    const proc = spawn(fs.existsSync(java) ? java : javaPath, ["-jar", installer, "--installClient", GAME_DIR], { cwd: path.dirname(installer), windowsHide: true });
    const onData = d => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 30) tail.shift();
        send("game:log", `[${kind}] ${line}`);
      }
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", reject);
    proc.on("close", resolve);
  });
  if (code !== 0 || !fs.existsSync(path.join(GAME_DIR, "versions", id, `${id}.json`))) {
    throw new Error(`Instalacja ${full} nie powiodła się (kod ${code}). ${tail.slice(-3).join(" ")}`);
  }
  fs.writeFileSync(path.join(GAME_DIR, "versions", id, FORGE_DONE), new Date().toISOString());
  send("game:log", `${full} zainstalowany`);
  return id;
}

// minecraft-launcher-core pomija argumenty JVM z profilu, a nowy Forge ich wymaga (moduły Javy,
// lista ignorowanych plików). Podstawiamy zmienne tak jak oficjalny launcher.
function forgeJvmArgs(profileId) {
  const profile = JSON.parse(fs.readFileSync(path.join(GAME_DIR, "versions", profileId, `${profileId}.json`), "utf8"));
  const jvm = (profile.arguments && profile.arguments.jvm) || [];
  const vars = {
    library_directory: path.join(GAME_DIR, "libraries"),
    classpath_separator: path.delimiter,
    version_name: profileId,
  };
  return jvm
    .filter(a => typeof a === "string")
    .map(a => a.replace(/\$\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)));
}

// Wersje gry na Forge z własną paczką: { "1.8.9": "xBobersonx PvP" }
ipcMain.handle("forge:versions", () => {
  const result = {};
  for (const v of Object.keys(require("./modpack.json").forge || {})) result[v] = packFor(v).name;
  return result;
});

ipcMain.handle("fabric:versions", async () => {
  const { data } = await cachedJson("https://meta.fabricmc.net/v2/versions/game", "fabric_versions");
  return data.map(v => v.version);
});

ipcMain.handle("app:version", () => require("./package.json").version);

// Paczka modów ma osobny folder gry na każdą wersję, żeby mody się nie mieszały
function packDir(version) {
  return path.join(GAME_DIR, "instances", `pack-${version}`);
}

// Paczka na nowym Forge ma osobny folder obok paczki Fabric tej samej wersji
function forgeDir(version) {
  return path.join(GAME_DIR, "instances", `forge-${version}`);
}

// Folder gry dla wpisu z listy wersji: paczka xBobersonx ("pack"), paczka na Forge ("forge") albo NeoForge
// ("neoforge"), albo modpack ("mp:<slug>")
function instanceDir(version, instance) {
  if (instance && instance.startsWith("mp:")) return mrpack.modpackDir(GAME_DIR, instance.slice(3));
  if (instance === "neoforge") return path.join(GAME_DIR, "instances", `neoforge-${version}`);
  return instance === "forge" ? forgeDir(version) : packDir(version);
}

// Dla modpack.js: wersja gry, a dla nowego Forge "forge:<wersja>" (inny loader na Modrinth i inny folder modów)
function modTarget(version, instance) {
  if (instance === "forge" || instance === "neoforge") return `${instance}:${version}`;
  if (instance && instance.startsWith("mp:")) {
    try {
      const { loader } = mrpack.readModpack(GAME_DIR, instance.slice(3));
      // profil na 1.8.9 używa starego Forge — jego mody leżą w mods/<wersja>, jak w paczce PvP
      if (loader === "forge" && forgePack(version)) return version;
      if (loader === "forge" || loader === "neoforge") return `${loader}:${version}`;
    } catch {}
  }
  return version;
}

const logToConsole = msg => send("game:log", msg);

ipcMain.handle("pack:name", () => packName);

ipcMain.handle("mods:list", (_e, { version, instance }) => listMods(instanceDir(version, instance), modTarget(version, instance)));
ipcMain.handle("mods:toggle", (_e, { version, instance, tab, key, enabled }) =>
  setModEnabled(instanceDir(version, instance), tab, key, enabled, modTarget(version, instance)));
ipcMain.handle("mods:search", (_e, { version, instance, query }) =>
  searchMods(instanceDir(version, instance), modTarget(version, instance), query));
ipcMain.handle("mods:install", (_e, { version, instance, id }) =>
  installOwnMod(instanceDir(version, instance), modTarget(version, instance), id, logToConsole));
ipcMain.handle("mods:check-updates", (_e, { version, instance }) =>
  checkOwnUpdates(instanceDir(version, instance), modTarget(version, instance)));
ipcMain.handle("mods:update", (_e, { version, instance, file }) => {
  if (gameRunning) throw new Error("Zamknij grę, zanim zaktualizujesz mody");
  return updateOwnMod(instanceDir(version, instance), modTarget(version, instance), file, logToConsole);
});

// Shadery i paczki tekstur (type: "shader" | "resourcepack")
ipcMain.handle("content:list", (_e, { version, instance, type }) => content.listContent(instanceDir(version, instance), version, type));
ipcMain.handle("content:search", (_e, { version, instance, type, query }) =>
  content.searchContent(instanceDir(version, instance), version, type, query));
ipcMain.handle("content:install", (_e, { version, instance, type, id }) =>
  content.installContent(instanceDir(version, instance), version, type, id));
ipcMain.handle("content:toggle", (_e, { version, instance, type, file, enabled }) =>
  content.setContentEnabled(instanceDir(version, instance), version, type, file, enabled));
ipcMain.handle("content:delete", (_e, { version, instance, type, file }) =>
  content.deleteContent(instanceDir(version, instance), version, type, file));

// Modpacki z Modrinth
ipcMain.handle("modpacks:list", () => mrpack.listModpacks(GAME_DIR));
ipcMain.handle("modpacks:search", (_e, { query }) => mrpack.searchModpacks(GAME_DIR, query));
ipcMain.handle("modpacks:install", (_e, { id }) =>
  mrpack.installModpack(GAME_DIR, id, {
    log: logToConsole,
    progress: p => send("modpacks:progress", p),
  }));
ipcMain.handle("modpacks:import", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: t("Importuj modpack"),
    filters: [{ name: "Modpack (.mrpack, .zip z CurseForge)", extensions: ["mrpack", "zip", "mcpack"] }],
    properties: ["openFile"],
  });
  if (canceled) return null;
  return mrpack.importModpack(GAME_DIR, filePaths[0], {
    log: logToConsole,
    progress: p => send("modpacks:progress", p),
  });
});
// Własne profile: { name, gameVersion, loader: fabric|forge|neoforge|vanilla, pack }
// Czy wybrany loader działa na danej wersji gry
async function checkProfileLoader(gameVersion, loader) {
  const supported = {
    vanilla: async () => true,
    fabric: async () => (await cachedJson("https://meta.fabricmc.net/v2/versions/game", "fabric_versions")).data.some(v => v.version === gameVersion),
    forge: async () => !!forgePack(gameVersion) || gameVersion in (await modernForgeBuilds()),
    neoforge: async () => gameVersion in (await neoforgeBuilds()),
  }[loader];
  const names = { fabric: "Fabric", forge: "Forge", neoforge: "NeoForge" };
  if (supported && !(await supported().catch(() => false))) {
    throw new Error(`${names[loader]} nie jest dostępny dla Minecrafta ${gameVersion}`);
  }
}

ipcMain.handle("profiles:create", async (_e, options) => {
  await checkProfileLoader(options.gameVersion, options.loader);
  return mrpack.createProfile(GAME_DIR, options);
});

ipcMain.handle("profiles:update", async (_e, { slug, ...options }) => {
  if (gameRunning) throw new Error("Zamknij grę, zanim zmienisz profil");
  await checkProfileLoader(options.gameVersion, options.loader);
  const oldTarget = modTarget(mrpack.readModpack(GAME_DIR, slug).gameVersion, `mp:${slug}`);
  const { before, after } = mrpack.updateProfile(GAME_DIR, slug, options);
  // mody paczki pasują tylko do jednej wersji i loadera — po zmianie albo wyłączeniu paczki usuwamy stare
  const moved = before.gameVersion !== after.gameVersion || before.loader !== after.loader;
  if (before.pack && (!after.pack || moved)) {
    const removed = removePack(mrpack.modpackDir(GAME_DIR, slug), oldTarget);
    logToConsole(`[profil] Usunięto ${removed} modów paczki z profilu ${after.title}`);
  }
  return { ...after, moved };
});

ipcMain.handle("profiles:duplicate", async (_e, { slug }) => {
  if (gameRunning) throw new Error("Zamknij grę, zanim skopiujesz profil");
  return mrpack.duplicateProfile(GAME_DIR, slug, { log: logToConsole });
});

ipcMain.handle("modpacks:delete", async (_e, { slug, title }) => {
  if (gameRunning) throw new Error("Zamknij grę, zanim usuniesz modpack");
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    title: t(slug.startsWith("profile-") ? "Usuń profil" : "Usuń modpack"),
    message: t(slug.startsWith("profile-") ? `Usunąć profil ${title}?` : `Usunąć modpack ${title}?`),
    detail: t("Razem z nim znikną jego światy, ustawienia i mody. Tego nie da się cofnąć."),
    buttons: [t("Usuń"), t("Anuluj")],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return false;
  mrpack.deleteModpack(GAME_DIR, slug);
  return true;
});

ipcMain.handle("folder:mods", (_e, { version, instance, preinstalled, content: type } = {}) => {
  const base = instanceDir(version, instance);
  const folders = { shader: "shaderpacks", resourcepack: "resourcepacks" };
  const dir = type ? path.join(base, folders[type]) : preinstalled ? packModsDir(base, modTarget(version, instance)) : path.join(base, "mods");
  fs.mkdirSync(dir, { recursive: true });
  return shell.openPath(dir);
});

// Zapisane konta Microsoft, zaszyfrowane przez system (DPAPI w Windows).
// Format: { active: id konta albo null (non-premium), list: [{ id, name, skin, token }] }
const NO_ACCOUNTS = () => ({ active: null, list: [] });
const LEGACY_ID = "legacy"; // konto ze starej wersji, której profil się nie zachował
let offlineProfile = null; // konto Microsoft bez internetu — nazwa i UUID bez tokenów
let loginSeq = 0; // przełączenie konta unieważnia logowanie, które jeszcze trwa

function encrypt(text) {
  return safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text);
}

function decrypt(data) {
  return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(data) : data.toString();
}

function saveAccounts(store) {
  fs.mkdirSync(GAME_DIR, { recursive: true });
  fs.writeFileSync(ACCOUNTS_FILE, encrypt(JSON.stringify(store)));
}

// Starsze wersje trzymały jedno konto w account.dat i account-profile.json
function migrateOldAccount() {
  if (!fs.existsSync(OLD_ACCOUNT_FILE)) return null;
  let profile = {};
  try { profile = JSON.parse(fs.readFileSync(OLD_PROFILE_FILE, "utf8")); } catch {}
  const id = profile.id || LEGACY_ID;
  const account = { id, name: profile.name || "Konto Microsoft", skin: profile.skin || null, token: decrypt(fs.readFileSync(OLD_ACCOUNT_FILE)) };
  const store = { active: id, list: [account] };
  saveAccounts(store);
  fs.rmSync(OLD_ACCOUNT_FILE, { force: true });
  fs.rmSync(OLD_PROFILE_FILE, { force: true });
  return store;
}

function loadAccounts() {
  try {
    if (fs.existsSync(ACCOUNTS_FILE)) return JSON.parse(decrypt(fs.readFileSync(ACCOUNTS_FILE)));
    return migrateOldAccount() || NO_ACCOUNTS();
  } catch {
    console.error("Nie udało się odczytać zapisanych kont");
    return NO_ACCOUNTS();
  }
}

function clearActiveAccount() {
  loginSeq++;
  msMinecraft = null;
  offlineProfile = null;
}

// Zwraca null, jeśli w międzyczasie gracz wybrał inne konto
async function finishLogin(xbox, seq) {
  const mc = await xbox.getMinecraft();
  if (seq !== loginSeq) return null;
  if (!mc.profile) throw new Error("To konto Microsoft nie ma kupionego Minecrafta");
  msMinecraft = mc;
  offlineProfile = null;
  const skins = mc.profile.skins || [];
  const url = (skins.find(s => s.state === "ACTIVE") || skins[0] || {}).url;
  const skin = url ? url.replace(/^http:/, "https:") : null;
  const account = { id: mc.profile.id, name: mc.profile.name, skin, token: xbox.save() };
  const store = loadAccounts();
  const others = store.list.filter(a => a.id !== LEGACY_ID);
  const index = others.findIndex(a => a.id === account.id);
  if (index >= 0) others[index] = account; else others.push(account);
  saveAccounts({ active: account.id, list: others });
  return { name: account.name, skin };
}

// Logowanie z zapisanego tokenu (bez okna). Bez internetu gramy offline na tym samym profilu.
async function activateAccount(account) {
  const seq = ++loginSeq;
  try {
    const xbox = await new Auth("select_account").refresh(account.token);
    if (seq !== loginSeq) return null;
    return await finishLogin(xbox, seq);
  } catch (err) {
    if (net.isOnline() || account.id === LEGACY_ID || seq !== loginSeq) throw err;
    msMinecraft = null;
    offlineProfile = { id: account.id, name: account.name };
    const store = loadAccounts();
    saveAccounts({ ...store, active: account.id });
    return { name: account.name, skin: null, offline: true };
  }
}

function removeAccount(id) {
  const store = loadAccounts();
  if (store.active === id) {
    clearActiveAccount();
    store.active = null;
  }
  store.list = store.list.filter(a => a.id !== id);
  saveAccounts(store);
}

ipcMain.handle("auth:microsoft", async () => {
  const xbox = await new Auth("select_account").launch("electron");
  return finishLogin(xbox, ++loginSeq);
});

ipcMain.handle("auth:restore", async () => {
  const store = loadAccounts();
  const account = store.list.find(a => a.id === store.active);
  if (!account) return null;
  try {
    return await activateAccount(account);
  } catch (err) {
    console.error("Nie udało się przywrócić logowania:", err);
    return null;
  }
});

// Bez tokenów — do okna trafiają tylko nazwy
ipcMain.handle("auth:accounts", () => {
  const store = loadAccounts();
  return store.list.map(({ id, name }) => ({ id, name, active: id === store.active }));
});

ipcMain.handle("auth:switch", (_e, id) => {
  const account = loadAccounts().list.find(a => a.id === id);
  if (!account) throw new Error("Nie ma takiego konta");
  return activateAccount(account);
});

ipcMain.handle("auth:use-nick", () => {
  clearActiveAccount();
  saveAccounts({ ...loadAccounts(), active: null });
});

ipcMain.handle("auth:remove", (_e, id) => removeAccount(id));
ipcMain.handle("auth:logout", () => removeAccount(loadAccounts().active));

// Dane logowania dla gry: konto Microsoft (odświeżone, jeśli się da), zapisany profil bez internetu
// albo konto non-premium z samym nickiem
async function gameAuthorization(nick, log) {
  if (msMinecraft) {
    // token Minecrafta ważny jest ok. 24h — odśwież, jeśli wygasł
    if (!msMinecraft.validate()) {
      try {
        msMinecraft = await msMinecraft.refresh(true);
      } catch (err) {
        log(`[konto] Nie można odświeżyć logowania (${err.message || err}) — gram offline na tym koncie`);
      }
    }
    return msMinecraft.mclc();
  }
  if (offlineProfile) {
    log("[konto] Brak internetu — gram offline na zapisanym koncie Microsoft");
    return {
      access_token: "0",
      client_token: "0",
      uuid: offlineProfile.id,
      name: offlineProfile.name,
      user_properties: "{}",
      meta: { type: "msa", demo: false },
    };
  }
  return Authenticator.getAuth(nick);
}

// Analiza crasha + powiązanie podejrzanych modów z plikami, żeby można je było wyłączyć
function describeCrash(instanceDir, version, target, log, code, reportFile) {
  const report = reportFile ? fs.readFileSync(reportFile, "utf8") : "";
  let { reason, generic, suspects, details } = analyze(log, code, report);
  const { own, pre } = listMods(instanceDir, target);
  const all = [...own.map(m => ({ ...m, tab: "own" })), ...pre.map(m => ({ ...m, tab: "pre" }))];

  // stos wywołań: w kodzie którego moda gra się wysypała (tylko mody, które były włączone)
  const ownDir = path.join(instanceDir, "mods");
  const preDir = packModsDir(instanceDir, target);
  const running = all
    .filter(m => m.enabled && m.modId)
    .map(m => ({ modId: m.modId, path: path.join(m.tab === "own" ? ownDir : preDir, m.file) }));
  let fromStack = [];
  try {
    fromStack = stackSuspects(`${report}\n${log}`, running)
      .filter(id => !["minecraft", "java", "fabricloader", "fabric", "forge", "fml", "mcp", "mixinextras"].includes(id));
  } catch {}
  const explicit = suspects.length > 0;
  suspects = [...new Set([...suspects, ...fromStack])].slice(0, 4);
  if (generic && !explicit && fromStack.length) {
    const first = all.find(m => m.modId === fromStack[0]);
    reason = `Gra wysypała się w kodzie moda ${first ? first.title : fromStack[0]}. ` +
      "Wyłącz go poniżej i uruchom grę ponownie — jeśli to nie pomoże, spróbuj następnego z listy.";
  }

  const mods = [];
  const unknown = [];
  for (const id of suspects) {
    const mod = all.find(m => m.modId === id);
    if (mod) mods.push({ title: mod.title, tab: mod.tab, key: mod.key, enabled: mod.enabled, library: !!mod.library });
    else unknown.push(id);
  }
  return { version, reason, details, mods, unknown, report: reportFile };
}

ipcMain.handle("crash:open-report", (_e, file) => shell.openPath(file));

// ---------- Miejsce na dysku ----------

// 1 świat, 2 światy, 5 światów
function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10, t = n % 100;
  return d >= 2 && d <= 4 && (t < 12 || t > 14) ? few : many;
}
const UPDATER_CACHE = path.join(app.getPath("home"), "AppData", "Local", "minecraft-by-xbobersonx-updater");

function ensureGameClosed() {
  if (gameRunning) throw new Error("Zamknij grę, zanim zaczniesz sprzątać");
}

ipcMain.handle("disk:scan", () => disk.scan(GAME_DIR, UPDATER_CACHE));
ipcMain.handle("disk:clean", () => {
  ensureGameClosed();
  return disk.cleanJunk(GAME_DIR, UPDATER_CACHE);
});
ipcMain.handle("disk:delete-version", async (_e, { key, label, worlds }) => {
  ensureGameClosed();
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    title: t("Usuń wersję"),
    message: t(`Usunąć ${label}?`),
    detail: t(worlds > 0
      ? `Razem z wersją znikną ${worlds} ${plural(worlds, "świat", "światy", "światów")}, mody, shadery i ustawienia tej wersji. Tego nie da się cofnąć.`
      : "Znikną mody, shadery i ustawienia tej wersji. Przy następnym uruchomieniu wszystko pobierze się od nowa."),
    buttons: [t("Usuń"), t("Anuluj")],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return null;
  return disk.deleteVersion(GAME_DIR, key);
});
ipcMain.handle("disk:open", () => shell.openPath(GAME_DIR));

// ---------- Własne tło launchera ----------
const BG_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

function customBackground() {
  if (!fs.existsSync(GAME_DIR)) return null;
  const name = fs.readdirSync(GAME_DIR).find(n => n.startsWith("background.") && BG_TYPES[path.extname(n).toLowerCase()]);
  return name ? path.join(GAME_DIR, name) : null;
}

// Obraz jako data URL — strona launchera nie może czytać plików spoza swojego folderu
function asDataUrl(file) {
  return `data:${BG_TYPES[path.extname(file).toLowerCase()]};base64,${fs.readFileSync(file).toString("base64")}`;
}

// Folder ze screenshotami z ostatnio używanej wersji — tam okno wyboru otwiera się na start
function screenshotsDir() {
  const instances = path.join(GAME_DIR, "instances");
  if (!fs.existsSync(instances)) return app.getPath("pictures");
  const dirs = fs.readdirSync(instances)
    .map(n => path.join(instances, n, "screenshots"))
    .filter(d => fs.existsSync(d))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] || app.getPath("pictures");
}

ipcMain.handle("background:get", () => {
  const file = customBackground();
  return file ? asDataUrl(file) : null;
});

ipcMain.handle("background:choose", async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: t("Wybierz tło launchera"),
    defaultPath: screenshotsDir(),
    filters: [{ name: t("Obrazy"), extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    properties: ["openFile"],
  });
  if (canceled || !filePaths[0]) return null;
  const old = customBackground();
  if (old) fs.rmSync(old, { force: true });
  const target = path.join(GAME_DIR, `background${path.extname(filePaths[0]).toLowerCase()}`);
  fs.mkdirSync(GAME_DIR, { recursive: true });
  fs.copyFileSync(filePaths[0], target);
  return asDataUrl(target);
});

ipcMain.handle("background:reset", () => {
  const old = customBackground();
  if (old) fs.rmSync(old, { force: true });
});

// Tło menu w grze (mod Bobr Config): to samo co tło launchera, zapisane jako PNG
// w <wersja>/bobrmc/menu-background.png. Bez własnego tła plik jest usuwany i mod pokazuje domyślne tło BobrMC.
const MENU_BACKGROUND = path.join("bobrmc", "menu-background.png");

// Paczka 1.8.9: OneConfig zostaje tylko jako biblioteka Patchera. Ustawienia są w menu Bobr Config,
// więc klawisz menu OneConfig (prawy Shift) jest odpinany przed każdym startem. OneConfig trzyma pliki
// w folderze głównym launchera (tam, gdzie gra jest uruchamiana).
function hideOneConfigMenu() {
  const file = path.join(GAME_DIR, "OneConfig", "Preferences.json");
  try {
    let prefs = {};
    if (fs.existsSync(file)) prefs = JSON.parse(fs.readFileSync(file, "utf8"));
    const keys = prefs.oneConfigKeyBind && prefs.oneConfigKeyBind.keyBinds;
    if (Array.isArray(keys) && keys.length === 0) return;
    prefs.oneConfigKeyBind = { keyBinds: [] };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(prefs, null, 2));
    send("game:log", "[paczka] Menu OneConfig ukryte — ustawienia są w Bobr Config (prawy Shift)");
  } catch (err) {
    send("game:log", `[paczka] Nie udało się ukryć menu OneConfig: ${err.message}`);
  }
}
function syncMenuBackground(gameDir) {
  const target = path.join(gameDir, MENU_BACKGROUND);
  try {
    const source = customBackground();
    // gra czyta tylko PNG (1.8.9 też JPG) — dlatego przepisujemy obraz; webp/gif, których Electron nie odczyta, pomijamy
    let image = source ? nativeImage.createFromPath(source) : null;
    if (!image || image.isEmpty()) {
      fs.rmSync(target, { force: true });
      return;
    }
    if (image.getSize().width > 2560) image = image.resize({ width: 2560, quality: "best" });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, image.toPNG());
  } catch (err) {
    console.warn("Tło menu w grze:", err.message);
  }
}

// "-Da=1 -Xss2M" -> ["-Da=1", "-Xss2M"]; cudzysłowy grupują argumenty ze spacjami
function splitArgs(text) {
  return (text.match(/"[^"]*"|\S+/g) || []).map(a => a.replace(/^"|"$/g, ""));
}

// ---------- Serwery ----------

// wynik „premium / non-premium” zapamiętujemy na dobę, żeby nie logować się na serwer przy każdym otwarciu okna
const PREMIUM_CACHE = path.join(GAME_DIR, "cache", "launcher", "servers-premium.json");
const PREMIUM_TTL = 24 * 3600 * 1000;

// trzymany w pamięci: okno pinguje wszystkie serwery naraz, a osobne czytanie pliku gubiłoby wpisy
let premiumCache = null;

ipcMain.handle("servers:ping", async (_e, address) => {
  const info = await servers.ping(address);
  const key = `${info.host}:${info.port}`;
  if (!premiumCache) {
    try { premiumCache = JSON.parse(fs.readFileSync(PREMIUM_CACHE, "utf8")); } catch { premiumCache = {}; }
  }
  const cache = premiumCache;
  const hit = cache[key];
  if (hit && Date.now() - hit.at < PREMIUM_TTL) {
    info.premium = hit.premium;
  } else {
    info.premium = await servers.checkPremium(info.host, info.port, info.protocol);
    if (info.premium) {
      cache[key] = { premium: info.premium, at: Date.now() };
      fs.mkdirSync(path.dirname(PREMIUM_CACHE), { recursive: true });
      fs.writeFileSync(PREMIUM_CACHE, JSON.stringify(cache));
    }
  }
  return info;
});

// Minecraft 1.20+ ma --quickPlayMultiplayer, starsze wersje --server/--port
function quickPlay(version, address) {
  const [major, minor] = version.split(".").map(Number);
  const legacy = major === 1 && minor < 20;
  return { type: legacy ? "legacy" : "multiplayer", identifier: address };
}

async function launchGame({ nick, version, ram, loader, window: gameWindow, afterLaunch, javaArgs, syncOptions, server, world }) {
  const launcher = new Client();

  // type trafia do --versionType; Minecraft pokazuje go na dole ekranu tytułowego
  // („Minecraft 1.21.11/xBobersonx”) i w F3
  const gameVersion = { number: version, type: "xBobersonx" };
  // loader: "pack" = paczka xBobersonx Mods, "mp:<slug>" = modpack z Modrinth
  const modpack = loader.startsWith("mp:") ? mrpack.readModpack(GAME_DIR, loader.slice(3)) : null;
  const gameDir = instanceDir(version, loader);
  // 1.8.9 (i inne wersje z sekcji „forge” w modpack.json) działa na starym Forge,
  // wpis „forge” (1.20+) na nowym Forge, reszta na Fabric
  // paczka xBobersonx na Forge/NeoForge albo modpack z Modrinth/CurseForge na Forge/NeoForge
  const modernForge = loader === "forge" || loader === "neoforge";
  // własny profil: osobna instancja; na 1.8.9 z Forge używa starego Forge, jak paczka PvP
  const profile = modpack && modpack.kind === "profile" ? modpack : null;
  const oldForgeProfile = profile && profile.loader === "forge" ? forgePack(version) : null;
  const vanilla = !!profile && profile.loader === "vanilla";
  const modpackForge = !!modpack && !oldForgeProfile && (modpack.loader === "forge" || modpack.loader === "neoforge");
  const forgeKind = modernForge ? loader : modpackForge ? modpack.loader : null;
  const forge = (!modpack && !modernForge && forgePack(version)) || oldForgeProfile;
  const target = modTarget(version, loader);
  const javaPath = await getJava(version, {
    runtimeRoot: path.join(GAME_DIR, "runtime"),
    manifestUrl: MANIFEST_URL,
    localJson: path.join(GAME_DIR, "versions", version, `${version}.json`),
    log: msg => send("game:log", msg),
    progress: p => send("game:progress", p),
  });
  let forgeJar = null;
  const forgeArgs = [];
  if (forge) {
    send("game:log", `Instalowanie Forge ${forge.build}...`);
    forgeJar = await installForge(forge.build);
    send("game:log", `Forge: ${forge.build}`);
  } else if (modernForge || modpackForge) {
    gameVersion.custom = await installForgeLoader(forgeKind, version, javaPath, modpackForge ? modpack.forgeVersion : null);
    forgeArgs.push(...forgeJvmArgs(gameVersion.custom));
    send("game:log", `${FORGE_KINDS[forgeKind].label}: ${gameVersion.custom}`);
  } else if (vanilla) {
    send("game:log", `Minecraft ${version} bez modów`);
  } else {
    send("game:log", "Instalowanie Fabric...");
    gameVersion.custom = await installFabric(version, modpack && modpack.fabricLoader);
    send("game:log", `Fabric: ${gameVersion.custom}`);
  }

  const jvmArgs = [...JVM_FLAGS, ...forgeArgs, ...splitArgs(javaArgs || "")];
  const withPack = loader === "pack" || modernForge || !!(profile && profile.pack);
  if (withPack) {
    const preinstalled = await installPack(gameDir, target, {
      log: msg => send("game:log", msg),
      progress: p => send("game:progress", p),
    });
    // Fabric nie czyta podfolderów mods/, więc wskazujemy mu preinstalled/ wprost;
    // stary Forge sam wczytuje mods/<wersja gry>/, nowy — mods/
    if (forge) hideOneConfigMenu();
    else if (!forgeKind) jvmArgs.push(`-Dfabric.addMods=${preinstalled}`);
  }

  // wspólne ustawienia dla wszystkich wersji: options.txt (1.8.9 w przeliczonym formacie),
  // lista serwerów, a w paczce xBobersonx też ustawienia modów, paczki tekstur i shadery
  // profil ma własne ustawienia — nie dostaje wspólnych (po to się go tworzy)
  const shareOptions = syncOptions && !profile;
  // ustawienia modów są wspólne tylko w obrębie jednego loadera (stary Forge, nowy Forge, Fabric)
  const shareScope = { loader: forge ? "forge" : forgeKind === "neoforge" ? "neoforge" : forgeKind ? "forge-modern" : "fabric", full: loader === "pack" || modernForge };
  if (shareOptions) {
    const seededFrom = gameOptions.seed(GAME_DIR, SHARED_OPTIONS);
    if (seededFrom) send("game:log", `[ustawienia] Wspólne ustawienia utworzone z ${seededFrom}`);
    if (gameOptions.push(gameDir, SHARED_OPTIONS, { legacy: !!forge })) send("game:log", "[ustawienia] Wgrano wspólne ustawienia");
    try {
      const done = sharedFiles.push(GAME_DIR, gameDir, shareScope);
      if (done.length) send("game:log", `[ustawienia] Wspólne: ${done.join(", ")}`);
    } catch (err) {
      send("game:log", `[ustawienia] Nie udało się wgrać wspólnych plików: ${err.message}`);
    }
  }
  syncMenuBackground(gameDir);

  if ((withPack && !forge) || (profile && !forge)) {
    // domyślne ustawienia tylko dla wersji, w której gra jeszcze ich nie zapisała
    // (options.txt mógł powstać wcześniej z samą listą paczek tekstur)
    const options = path.join(gameDir, "options.txt");
    const current = fs.existsSync(options) ? fs.readFileSync(options, "utf8") : "";
    if (!current.includes("renderDistance:")) fs.writeFileSync(options, `${fs.readFileSync(DEFAULT_OPTIONS, "utf8")}${current}`);
  }

  // ostatnie linie logu gry — do analizy, jeśli gra się wysypie
  const logTail = [];
  const remember = text => {
    logTail.push(...text.split(/\r?\n/));
    if (logTail.length > 800) logTail.splice(0, logTail.length - 800);
  };
  const startedAt = Date.now();
  let optionsLoadFailed = false; // gra zapisała wtedy domyślne — nie mogą trafić do wspólnej kopii

  launcher.on("progress", p => send("game:progress", p));
  launcher.on("download-status", p => send("game:download", p));
  launcher.on("data", d => {
    send("game:log", d.toString());
    remember(d.toString());
    if (d.toString().includes("Failed to load options")) optionsLoadFailed = true;
  });
  launcher.on("debug", d => send("game:log", d.toString()));
  let playStartedAt = null;
  launcher.on("arguments", () => {
    playStartedAt = Date.now();
    gameRunning = true;
    send("game:started");
    if (afterLaunch === "close") setTimeout(() => app.quit(), 3000); // gra działa dalej jako osobny proces
    else if (afterLaunch !== "keep") hideToTray();
  });
  launcher.on("close", code => {
    gameRunning = false;
    // czas gry i „ostatnio grane” dla ekranu Home
    try {
      if (playStartedAt) recordPlay({ key: `${version}|${loader}`, version, server: server || null, world: world || null, at: Date.now() }, (Date.now() - playStartedAt) / 1000);
    } catch {}
    showFromTray();
    send("game:closed", code);
    // błąd przy sprzątaniu po grze nie może wywalić całego launchera
    try {
      if (shareOptions && !optionsLoadFailed) gameOptions.pull(gameDir, SHARED_OPTIONS, { legacy: !!forge });
      if (shareOptions) sharedFiles.pull(GAME_DIR, gameDir, shareScope);
      const report = findCrashReport(gameDir, startedAt);
      if (code !== 0 || report) {
        send("game:crash", { ...describeCrash(gameDir, version, target, logTail.join("\n"), code, report), instance: loader });
      }
    } catch (err) {
      send("game:log", `[launcher] Błąd po zamknięciu gry: ${err.message}`);
    }
  });

  const authorization = await gameAuthorization(nick, msg => send("game:log", msg));

  const proc = await launcher.launch({
    root: GAME_DIR,
    authorization,
    version: gameVersion,
    memory: { max: `${ram}G`, min: `${Math.min(2, ram)}G` },
    javaPath,
    forge: forgeJar || undefined,
    overrides: {
      gameDirectory: gameDir,
      url: { mavenForge: FORGE_MAVEN }, // domyślny adres files.minecraftforge.net tylko przekierowuje
    },
    customArgs: jvmArgs,
    quickPlay: server ? quickPlay(version, server) : world ? { type: "singleplayer", identifier: world } : undefined,
    window: gameWindow && gameWindow.fullscreen
      ? { fullscreen: true }
      : { width: (gameWindow && gameWindow.width) || 1280, height: (gameWindow && gameWindow.height) || 720 },
  });
  if (!proc) throw new Error("Nie udało się uruchomić gry (sprawdź logi).");
  return true;
}
ipcMain.handle("game:launch", (_e, options) => launchGame(options));



// Tylko jedno okno launchera — drugie uruchomienie pokazuje to, które już działa
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showFromTray);
  app.whenReady().then(createWindow);
}
app.on("window-all-closed", () => app.quit());
