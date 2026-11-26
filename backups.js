// Kopie zapasowe światów w profilach i modpackach: <instancja>/backups/*.zip
// Każde archiwum ma folder world/ (zawartość świata) i bobrmc-backup.json z nazwą świata i datą.

const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const META = "bobrmc-backup.json";
const KEEP_AUTO = 3; // automatycznych kopii jednego świata trzymamy najwyżej tyle

const backupsDir = instanceDir => path.join(instanceDir, "backups");
const savesDir = instanceDir => path.join(instanceDir, "saves");

function checkWorldName(world) {
  if (!world || /[\\/]/.test(world) || world === "." || world === "..") throw new Error(`Zła nazwa świata: ${world}`);
  return world;
}

function checkBackupName(file) {
  if (!/^[\w.-]+\.zip$/.test(file) || file.includes("..")) throw new Error(`Zła nazwa kopii: ${file}`);
  return file;
}

function folderSize(dir) {
  let size = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) size += folderSize(p);
    else if (entry.isFile()) size += fs.statSync(p).size;
  }
  return size;
}

// Światy instancji (foldery w saves/ z level.dat)
function listWorlds(instanceDir) {
  const dir = savesDir(instanceDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, "level.dat")))
    .map(e => ({ name: e.name, size: folderSize(path.join(dir, e.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readMeta(file) {
  try {
    const zip = new AdmZip(file);
    const meta = JSON.parse(zip.readAsText(META));
    return meta && meta.world ? meta : null;
  } catch {
    return null;
  }
}

// Kopie od najnowszej: { file, world, created, auto, reason, size }
function listBackups(instanceDir) {
  const dir = backupsDir(instanceDir);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(n => n.toLowerCase().endsWith(".zip"))
    .map(n => {
      const meta = readMeta(path.join(dir, n));
      return meta && { file: n, world: meta.world, created: meta.created, auto: !!meta.auto, reason: meta.reason || "", size: fs.statSync(path.join(dir, n)).size };
    })
    .filter(Boolean)
    .sort((a, b) => b.created - a.created);
}

function stamp(date) {
  const p = n => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

// reason: krótki opis (np. „przed zmianą na 1.21.11 Fabric”); auto: kopia zrobiona przez launcher
async function createBackup(instanceDir, world, { auto = false, reason = "" } = {}) {
  checkWorldName(world);
  const src = path.join(savesDir(instanceDir), world);
  if (!fs.existsSync(path.join(src, "level.dat"))) throw new Error(`Nie ma świata ${world}`);
  const now = new Date();
  const safe = world.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").replace(/^[_.]+|[_.]+$/g, "").slice(0, 40) || "swiat";
  const dir = backupsDir(instanceDir);
  fs.mkdirSync(dir, { recursive: true });
  let file = `${safe}_${stamp(now)}.zip`;
  for (let i = 2; fs.existsSync(path.join(dir, file)); i++) file = `${safe}_${stamp(now)}-${i}.zip`;

  const zip = new AdmZip();
  // session.lock jest zablokowany przez działającą grę i nie jest potrzebny w kopii
  zip.addLocalFolder(src, "world", name => !/(^|[\\/])session\.lock$/.test(name));
  zip.addFile(META, Buffer.from(JSON.stringify({ world, created: now.getTime(), auto, reason }, null, 2)));
  // najpierw do pliku tymczasowego — przerwany zapis nie zostawi połowy kopii na liście
  const target = path.join(dir, file);
  await zip.writeZipPromise(`${target}.part`);
  fs.renameSync(`${target}.part`, target);
  if (auto) pruneAuto(instanceDir, world);
  return { file, world, created: now.getTime(), auto, reason, size: fs.statSync(target).size };
}

function pruneAuto(instanceDir, world) {
  const autos = listBackups(instanceDir).filter(b => b.auto && b.world === world);
  for (const old of autos.slice(KEEP_AUTO)) fs.rmSync(path.join(backupsDir(instanceDir), old.file), { force: true });
}

// Kopia wszystkich światów (np. przed zmianą wersji gry w profilu)
async function backupAll(instanceDir, reason) {
  const made = [];
  for (const w of listWorlds(instanceDir)) made.push(await createBackup(instanceDir, w.name, { auto: true, reason }));
  return made;
}

// Przywraca świat z kopii; obecny świat o tej nazwie najpierw trafia do kopii, więc nic nie ginie
async function restoreBackup(instanceDir, file) {
  checkBackupName(file);
  const archive = path.join(backupsDir(instanceDir), file);
  const meta = readMeta(archive);
  if (!meta) throw new Error("Ta kopia jest uszkodzona");
  const world = checkWorldName(meta.world);
  const saves = savesDir(instanceDir);
  const target = path.join(saves, world);
  let saved = null;
  if (fs.existsSync(path.join(target, "level.dat"))) {
    saved = await createBackup(instanceDir, world, { auto: true, reason: "przed przywróceniem kopii" });
  }
  // rozpakowujemy obok i dopiero potem podmieniamy folder świata
  const temp = path.join(saves, `.${world}.restore`);
  fs.rmSync(temp, { recursive: true, force: true });
  const zip = new AdmZip(archive);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith("world/")) continue;
    const out = path.resolve(temp, entry.entryName.slice("world/".length));
    if (!out.startsWith(temp + path.sep)) throw new Error(`Niebezpieczna ścieżka w kopii: ${entry.entryName}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, entry.getData());
  }
  if (!fs.existsSync(path.join(temp, "level.dat"))) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw new Error("W kopii nie ma świata");
  }
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(temp, target);
  return { world, saved };
}

function deleteBackup(instanceDir, file) {
  fs.rmSync(path.join(backupsDir(instanceDir), checkBackupName(file)), { force: true });
}

module.exports = { listWorlds, listBackups, createBackup, backupAll, restoreBackup, deleteBackup, backupsDir };
