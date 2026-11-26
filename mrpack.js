// Gotowe modpacki z Modrinth (.mrpack): wyszukiwanie, instalacja do osobnego folderu, usuwanie.
// Obsługiwane są modpacki na Fabric, Forge (od 1.13) i NeoForge (od 1.20.2); z pliku także .zip z CurseForge.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const AdmZip = require("adm-zip");
const { pool } = require("./modpack");

const API = "https://api.modrinth.com/v2";
const HEADERS = { "User-Agent": "xBobersonx/minecraft-launcher/1.0.0" };
const INFO = ".xbobersonx-modpack.json";

async function getJson(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Modrinth: ${res.status}`);
  return res.json();
}

function modpackDir(gameDir, slug) {
  if (!/^[\w.-]+$/.test(slug) || slug.includes("..")) throw new Error(`Zła nazwa modpacka: ${slug}`);
  return path.join(gameDir, "instances", `mp-${slug}`);
}

function readInfo(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

// Zainstalowane modpacki (z ich zapisanymi informacjami)
function listModpacks(gameDir) {
  const dir = path.join(gameDir, "instances");
  if (!fs.existsSync(dir)) return [];
  // uszkodzony plik jednego modpacka nie może zablokować całej listy wersji
  return fs.readdirSync(dir)
    .filter(n => n.startsWith("mp-"))
    .map(n => readInfo(path.join(dir, n, INFO)))
    .filter(info => info && info.slug && info.title)
    .sort((a, b) => a.title.localeCompare(b.title));
}

function readModpack(gameDir, slug) {
  return JSON.parse(fs.readFileSync(path.join(modpackDir(gameDir, slug), INFO), "utf8"));
}

async function searchModpacks(gameDir, query) {
  const facets = JSON.stringify([["project_type:modpack"], ["categories:fabric", "categories:forge", "categories:neoforge"]]);
  const index = query ? "relevance" : "downloads";
  const data = await getJson(`${API}/search?limit=30&index=${index}&query=${encodeURIComponent(query)}&facets=${encodeURIComponent(facets)}`);
  const installed = new Set(listModpacks(gameDir).map(m => m.id));
  return data.hits.map(h => ({
    id: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    author: h.author,
    downloads: h.downloads,
    icon: h.icon_url,
    versions: h.versions,
    installed: installed.has(h.project_id),
  }));
}

// Ścieżka z modpacka nie może wyjść poza folder modpacka
function safeJoin(root, rel) {
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Niebezpieczna ścieżka w modpacku: ${rel}`);
  return target;
}

async function downloadChecked(file, target) {
  const sha1 = file.hashes && file.hashes.sha1;
  if (fs.existsSync(target) && sha1 && crypto.createHash("sha1").update(fs.readFileSync(target)).digest("hex") === sha1) return;
  let lastError;
  for (const url of file.downloads) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error(`${res.status}`);
      const data = Buffer.from(await res.arrayBuffer());
      if (sha1 && crypto.createHash("sha1").update(data).digest("hex") !== sha1) throw new Error("zła suma kontrolna");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Nie udało się pobrać ${file.path} (${lastError && lastError.message})`);
}

function versionAtLeast(version, min) {
  const a = String(version).split(".").map(Number), b = String(min).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

// Forge w modpackach: od 1.13 instalator przerabia grę sam (--installClient); starsze wersje mają inny instalator
const FORGE_MIN = "1.13";

// Loader modpacka: { loader: "fabric", fabricLoader } albo { loader: "forge", forgeVersion }
function checkLoader(gameVersion, loader, loaderVersion) {
  if (loader === "fabric") return { loader, fabricLoader: loaderVersion };
  if (loader === "forge") {
    if (!versionAtLeast(gameVersion, FORGE_MIN)) {
      throw new Error(`Modpacki na Forge działają od Minecrafta ${FORGE_MIN} — ten jest na ${gameVersion}`);
    }
    return { loader, forgeVersion: loaderVersion };
  }
  // NeoForge dla 1.20.1 to jeszcze odmiana Forge (inny instalator) — obsługujemy od 1.20.2
  if (loader === "neoforge") {
    if (!versionAtLeast(gameVersion, "1.20.2")) {
      throw new Error(`Modpacki na NeoForge działają od Minecrafta 1.20.2 — ten jest na ${gameVersion}`);
    }
    return { loader, forgeVersion: loaderVersion };
  }
  const names = { quilt: "Quilt" };
  throw new Error(`Ten modpack wymaga ${names[loader] || loader} — launcher obsługuje Fabric, Forge i NeoForge`);
}

// Zawartość archiwum .mrpack; launcher obsługuje modpacki na Fabric i Forge
function readIndex(zip) {
  let index;
  try {
    index = JSON.parse(zip.readAsText("modrinth.index.json"));
  } catch {
    throw new Error("To nie jest poprawny modpack .mrpack");
  }
  const deps = index.dependencies || {};
  if (!deps.minecraft) throw new Error("Modpack nie podaje wersji Minecrafta");
  const loader = deps["fabric-loader"] ? "fabric" : deps.forge ? "forge" : deps.neoforge ? "neoforge" : Object.keys(deps).find(k => k !== "minecraft") || "inny loader";
  index.loaderInfo = checkLoader(deps.minecraft, loader.replace(/-loader$/, ""), deps["fabric-loader"] || deps.forge || deps.neoforge);
  return index;
}

const clientFiles = index => (index.files || []).filter(f => !f.env || f.env.client !== "unsupported");

// identity = { id, slug, title, icon, version } — dane modpacka zapisywane obok jego plików
async function unpack(gameDir, zip, index, identity, { log, progress }) {
  const deps = index.dependencies;
  const dir = modpackDir(gameDir, identity.slug);
  fs.mkdirSync(dir, { recursive: true });
  const files = clientFiles(index);
  let done = 0;
  progress({ task: 0, total: files.length });
  await pool(files, 8, async f => {
    await downloadChecked(f, safeJoin(dir, f.path));
    progress({ task: ++done, total: files.length });
  });

  // pliki konfiguracyjne modpacka (overrides/ i client-overrides/)
  copyOverrides(zip, dir, ["overrides/", "client-overrides/"]);
  return saveInfo(dir, { ...identity, gameVersion: deps.minecraft, ...index.loaderInfo }, files.length, log);
}

function copyOverrides(zip, dir, prefixes) {
  for (const prefix of prefixes) {
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith(prefix)) continue;
      const target = safeJoin(dir, entry.entryName.slice(prefix.length));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.getData());
    }
  }
}

function saveInfo(dir, info, count, log) {
  fs.writeFileSync(path.join(dir, INFO), JSON.stringify(info, null, 2));
  const loader = { forge: "Forge", neoforge: "NeoForge" }[info.loader] || "Fabric";
  log(`[modpack] Zainstalowano ${info.title} (Minecraft ${info.gameVersion}, ${loader}, ${count} plików)`);
  return info;
}

// ---------- Modpacki z CurseForge (.zip z manifest.json) ----------
// Pliki pobieramy przez publiczny adres curseforge.com, który przekierowuje na serwer plików forgecdn.net.
// Autor moda może zabronić pobierania spoza CurseForge — takie mody gracz musi wgrać sam (podajemy listę).

const CF_DOWNLOAD = (project, file) => `https://www.curseforge.com/api/v1/mods/${project}/files/${file}/download`;
const CF_HOSTS = /(^|\.)forgecdn\.net$/;

function readCurseManifest(zip) {
  let manifest;
  try {
    manifest = JSON.parse(zip.readAsText("manifest.json"));
  } catch {
    return null;
  }
  if (!manifest || manifest.manifestType !== "minecraftModpack" || !manifest.minecraft) return null;
  const gameVersion = manifest.minecraft.version;
  if (!gameVersion) throw new Error("Modpack nie podaje wersji Minecrafta");
  const loaders = manifest.minecraft.modLoaders || [];
  const primary = loaders.find(l => l.primary) || loaders[0];
  if (!primary || !primary.id) throw new Error("Modpack nie podaje loadera modów");
  const [, loader, loaderVersion] = /^([a-z]+)-(.+)$/.exec(primary.id) || [null, primary.id, ""];
  // CurseForge podaje Forge jako „forge-47.2.0”, czasem z wersją gry z przodu („forge-1.20.1-47.2.0”)
  const version = loader === "forge" || loader === "neoforge" ? loaderVersion.replace(new RegExp(`^${gameVersion.replace(/\./g, "\\.")}-`), "") : loaderVersion;
  manifest.loaderInfo = checkLoader(gameVersion, loader, version);
  return manifest;
}

// Gdzie położyć plik z CurseForge: .jar to mod; .zip to paczka tekstur albo shader (shader ma folder shaders/)
function curseTarget(name, data) {
  if (/\.jar$/i.test(name)) return "mods";
  if (/\.zip$/i.test(name)) {
    try {
      if (new AdmZip(data).getEntries().some(e => /^shaders\//.test(e.entryName))) return "shaderpacks";
    } catch {}
    return "resourcepacks";
  }
  return null;
}

async function downloadCurse(dir, entry) {
  const res = await fetch(CF_DOWNLOAD(entry.projectID, entry.fileID), { headers: HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status}`);
  const finalUrl = new URL(res.url);
  if (finalUrl.protocol !== "https:" || !CF_HOSTS.test(finalUrl.hostname)) throw new Error("niedozwolony adres pobierania");
  const name = decodeURIComponent(finalUrl.pathname.split("/").pop() || "");
  if (!name || /[\\/:*?"<>|]/.test(name) || name.startsWith(".")) throw new Error(`zła nazwa pliku ${name}`);
  const data = Buffer.from(await res.arrayBuffer());
  const folder = curseTarget(name, data);
  if (!folder) throw new Error(`nieznany typ pliku ${name}`);
  const target = safeJoin(dir, path.join(folder, name));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
  return name;
}

async function importCurse(gameDir, zip, manifest, fallbackTitle, { log, progress }) {
  const title = String(manifest.name || fallbackTitle);
  const slug = slugFromName(title);
  const dir = modpackDir(gameDir, slug);
  if (fs.existsSync(path.join(dir, INFO))) {
    throw new Error(`Modpack „${title}” jest już zainstalowany — usuń go najpierw, jeśli chcesz wgrać go od nowa`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const files = (manifest.files || []).filter(f => f.required !== false && Number.isInteger(f.projectID) && Number.isInteger(f.fileID));
  const missing = [];
  let done = 0;
  progress({ task: 0, total: files.length });
  await pool(files, 6, async f => {
    try {
      await downloadCurse(dir, f);
    } catch (err) {
      missing.push(`https://www.curseforge.com/projects/${f.projectID} (plik ${f.fileID}: ${err.message})`);
    }
    progress({ task: ++done, total: files.length });
  });
  copyOverrides(zip, dir, [`${String(manifest.overrides || "overrides").replace(/\/?$/, "/")}`]);

  const identity = { id: `file:${slug}`, slug, title, icon: null, version: String(manifest.version || "") };
  const info = saveInfo(dir, { ...identity, gameVersion: manifest.minecraft.version, ...manifest.loaderInfo }, files.length - missing.length, log);
  if (missing.length) {
    log(`[modpack] ${missing.length} modów nie dało się pobrać automatycznie (autor zablokował pobieranie spoza CurseForge). Pobierz je ręcznie do folderu mods:`);
    for (const m of missing) log(`[modpack]   ${m}`);
    info.missing = missing.length;
  }
  return info;
}

// Instaluje najnowszą wersję modpacka na Fabric albo Forge. progress({ task, total }), log(tekst)
async function installModpack(gameDir, projectId, options) {
  const project = await getJson(`${API}/project/${projectId}`);
  const versions = await getJson(`${API}/project/${projectId}/version?loaders=${encodeURIComponent('["fabric","forge","neoforge"]')}`);
  const version = versions.find(v => v.version_type === "release") || versions[0];
  if (!version) throw new Error("Ten modpack nie ma wersji na Fabric, Forge ani NeoForge");
  const packFile = version.files.find(f => f.primary) || version.files[0];

  options.log(`[modpack] Pobieranie ${project.title} ${version.version_number}...`);
  const res = await fetch(packFile.url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Nie udało się pobrać modpacka (${res.status})`);
  const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
  const identity = { id: project.id, slug: project.slug, title: project.title, icon: project.icon_url, version: version.version_number };
  return unpack(gameDir, zip, readIndex(zip), identity, options);
}

// Tylko serwery dozwolone przez specyfikację .mrpack — plik z dysku może pochodzić skądkolwiek
const ALLOWED_HOSTS = new Set(["cdn.modrinth.com", "github.com", "raw.githubusercontent.com", "gitlab.com"]);

function allowedDownloads(file) {
  return (file.downloads || []).filter(url => {
    try {
      const { protocol, hostname } = new URL(url);
      return protocol === "https:" && ALLOWED_HOSTS.has(hostname);
    } catch {
      return false;
    }
  });
}

function slugFromName(name) {
  const slug = String(name).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/Ł/g, "L")
    .replace(/[^\w.-]+/g, "-").replace(/\.{2,}/g, ".").replace(/^[-.]+|[-.]+$/g, "").toLowerCase().slice(0, 60);
  return `file-${slug || "modpack"}`;
}

// Modpack z pliku na dysku
async function importModpack(gameDir, file, options) {
  if (path.extname(file).toLowerCase() === ".mcpack") {
    throw new Error("Pliki .mcpack są z Minecrafta Bedrock i nie działają w wersji Java — launcher importuje modpacki .mrpack");
  }
  let zip;
  try {
    zip = new AdmZip(file);
  } catch {
    throw new Error("To nie jest poprawny modpack (.mrpack z Modrinth albo .zip z CurseForge)");
  }
  // .zip z CurseForge (manifest.json); .mrpack z Modrinth ma modrinth.index.json
  if (!zip.getEntry("modrinth.index.json")) {
    const manifest = readCurseManifest(zip);
    if (!manifest) throw new Error("To nie jest poprawny modpack (.mrpack z Modrinth albo .zip z CurseForge)");
    return importCurse(gameDir, zip, manifest, path.basename(file, path.extname(file)), options);
  }
  const index = readIndex(zip);
  for (const f of clientFiles(index)) {
    f.downloads = allowedDownloads(f);
    if (!f.downloads.length) throw new Error(`Modpack pobiera ${f.path} z niedozwolonego adresu`);
    if (!f.hashes || !f.hashes.sha1) throw new Error(`Modpack nie podaje sumy kontrolnej dla ${f.path}`);
  }

  const title = String(index.name || path.basename(file, path.extname(file)));
  const slug = slugFromName(title);
  if (fs.existsSync(path.join(modpackDir(gameDir, slug), INFO))) {
    throw new Error(`Modpack „${title}” jest już zainstalowany — usuń go najpierw, jeśli chcesz wgrać go od nowa`);
  }
  const identity = { id: `file:${slug}`, slug, title, icon: null, version: String(index.versionId || "") };
  return unpack(gameDir, zip, index, identity, options);
}

// ---------- Własne profile ----------
// Profil to pusta instancja z własnym folderem (mody, światy, paczki tekstur, ustawienia) na wybranej wersji
// i loaderze; opcjonalnie z paczką modów xBobersonx. Zapisany jak modpack (mp-profile-…), więc lista wersji,
// okno modów, światy i usuwanie działają tak samo.
const PROFILE_LOADERS = new Set(["fabric", "forge", "neoforge", "vanilla"]);

// Sprawdza nazwę profilu (exceptSlug: profil, który właśnie edytujemy, może zostać przy swojej nazwie)
function profileTitle(gameDir, name, exceptSlug) {
  const title = String(name || "").trim().replace(/\s+/g, " ");
  if (!title) throw new Error("Wpisz nazwę profilu");
  if (title.length > 40) throw new Error("Nazwa profilu może mieć najwyżej 40 znaków");
  if (listModpacks(gameDir).some(m => m.kind === "profile" && m.slug !== exceptSlug && m.title.toLowerCase() === title.toLowerCase())) {
    throw new Error(`Profil „${title}” już istnieje`);
  }
  return title;
}

function checkProfileTarget(gameVersion, loader) {
  if (!/^\d+\.\d+(\.\d+)?$/.test(String(gameVersion))) throw new Error("Wybierz wersję gry");
  if (!PROFILE_LOADERS.has(loader)) throw new Error("Wybierz loader");
}

function freeProfileSlug(gameDir, title) {
  const base = `profile-${slugFromName(title).slice("file-".length)}`;
  let slug = base;
  for (let i = 2; fs.existsSync(modpackDir(gameDir, slug)); i++) slug = `${base}-${i}`;
  return slug;
}

function readProfile(gameDir, slug) {
  const info = readModpack(gameDir, slug);
  if (info.kind !== "profile") throw new Error("To nie jest profil");
  return info;
}

function createProfile(gameDir, { name, gameVersion, loader, pack }) {
  const title = profileTitle(gameDir, name);
  checkProfileTarget(gameVersion, loader);
  const slug = freeProfileSlug(gameDir, title);
  const dir = modpackDir(gameDir, slug);
  for (const sub of ["mods", "saves", "resourcepacks", "config"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  const info = {
    id: `profile:${slug}`, slug, title, icon: null, version: "", kind: "profile",
    gameVersion: String(gameVersion), loader, pack: !!pack && loader !== "vanilla", created: Date.now(),
  };
  fs.writeFileSync(path.join(dir, INFO), JSON.stringify(info, null, 2));
  return info;
}

// Zmienia nazwę, wersję gry, loader albo paczkę modów; folder (a z nim światy i ustawienia) zostaje ten sam.
// Zwraca { before, after } — main.js na tej podstawie sprząta mody paczki po starej wersji/loaderze.
function updateProfile(gameDir, slug, { name, gameVersion, loader, pack }) {
  const before = readProfile(gameDir, slug);
  const title = profileTitle(gameDir, name, slug);
  checkProfileTarget(gameVersion, loader);
  const after = { ...before, title, gameVersion: String(gameVersion), loader, pack: !!pack && loader !== "vanilla", updated: Date.now() };
  fs.writeFileSync(path.join(modpackDir(gameDir, slug), INFO), JSON.stringify(after, null, 2));
  return { before, after };
}

// Kopia profilu z modami, światami, paczkami tekstur i ustawieniami
function duplicateProfile(gameDir, slug, { log } = {}) {
  const source = readProfile(gameDir, slug);
  let title = `${source.title} (kopia)`.slice(0, 40);
  for (let i = 2; listModpacks(gameDir).some(m => m.kind === "profile" && m.title.toLowerCase() === title.toLowerCase()); i++) {
    title = `${source.title.slice(0, 30)} (kopia ${i})`;
  }
  const newSlug = freeProfileSlug(gameDir, title);
  const from = modpackDir(gameDir, slug), to = modpackDir(gameDir, newSlug);
  if (log) log(`[profil] Kopiowanie ${source.title}...`);
  // logi i zrzuty awarii nie są potrzebne w kopii
  const skip = new Set(["logs", "crash-reports"].map(n => path.resolve(from, n).toLowerCase()));
  // Node na Windows podaje ścieżki z przedrostkiem \\?\ — bez niego porównujemy z listą pomijanych
  const plain = src => path.resolve(String(src).replace(/^\\\\\?\\/, "")).toLowerCase();
  fs.cpSync(from, to, { recursive: true, filter: src => !skip.has(plain(src)) });
  const info = { ...source, id: `profile:${newSlug}`, slug: newSlug, title, created: Date.now() };
  delete info.updated;
  fs.writeFileSync(path.join(to, INFO), JSON.stringify(info, null, 2));
  return info;
}

function deleteModpack(gameDir, slug) {
  fs.rmSync(modpackDir(gameDir, slug), { recursive: true, force: true });
}

module.exports = {
  listModpacks, readModpack, searchModpacks, installModpack, importModpack,
  createProfile, updateProfile, duplicateProfile, deleteModpack, modpackDir,
};
