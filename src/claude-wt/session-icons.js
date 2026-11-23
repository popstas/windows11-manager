/**
 * Явная иконка и значок окна сессии, заданные из claude-wt CLI
 * (`claude-wt window icon|badge`). Спека —
 * docs/superpowers/specs/2026-11-23-session-icon-design.md.
 *
 * Имена — только файлы `.ico` из `claudeWt.windowIcons.dir`, плоско и без
 * учёта регистра: имя ищется в списке файлов папки, а не склеивается с ней в
 * путь, поэтому `../x` и `sub/x` не находятся сами собой — проверять их
 * отдельно не нужно.
 *
 * Хранилище — JSON у службы (`node src/index.js mqtt`), ключ — sessionId:
 * `{ icon?, badge?, at }`. Писатель один — процесс службы: файл читается один
 * раз при создании, дальше правда в памяти. `at` — когда запись последний раз
 * была нужна (задана командой или окно сессии на экране); служба освежает его
 * каждый тик через `touch`, а на диск это уходит не чаще раза в сутки — иначе
 * открытое месяц окно потеряло бы заданное, или диск трогался бы каждые 3 с.
 * Записи, не нужные дольше KEEP_MS, выбрасываются при записи файла.
 */
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../commands/write-file-atomic.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_MS = 30 * DAY_MS;
const KINDS = ['icon', 'badge'];

function iconFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isFile() && /\.ico$/i.test(e.name))
    .map(e => e.name);
}

const stem = file => file.replace(/\.ico$/i, '');

/** Имена `.ico` папки без расширения, по алфавиту. Нет папки — бросает. */
function listIcons(dir) {
  return iconFiles(dir).map(stem).sort((a, b) => a.localeCompare(b));
}

/** Абсолютный путь файла с именем `name` (без учёта регистра) или null. */
function resolveIcon(name, dir) {
  if (typeof name !== 'string' || !name) return null;
  const want = name.toLowerCase();
  const file = iconFiles(dir).find(f => stem(f).toLowerCase() === want);
  return file ? path.join(dir, file) : null;
}

function readEntries(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return Object.create(null);
    // Без прототипа: ключ `__proto__` из файла — обычная запись.
    const out = Object.create(null);
    for (const [id, e] of Object.entries(data)) {
      if (!e || typeof e !== 'object') continue;
      const entry = { at: Number(e.at) || 0 };
      for (const k of KINDS) if (typeof e[k] === 'string' && e[k]) entry[k] = e[k];
      if (KINDS.some(k => entry[k])) out[id] = entry;
    }
    return out;
  } catch {
    // Нет файла или он битый — начинаем с пустого: заданное агентом не
    // стоит того, чтобы служба иконок не поднялась.
    return Object.create(null);
  }
}

function createSessionIconStore({ file, now = () => Date.now() }) {
  const entries = readEntries(file);
  // Какой `at` записи лежит на диске — по нему touch решает, пора ли писать.
  const diskAt = new Map(Object.entries(entries).map(([id, e]) => [id, e.at]));
  let version = 0;

  function write() {
    const t = now();
    for (const [id, e] of Object.entries(entries)) {
      if (t - e.at > KEEP_MS) {
        delete entries[id];
        version += 1;
      }
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, JSON.stringify(entries, null, 2));
    diskAt.clear();
    for (const [id, e] of Object.entries(entries)) diskAt.set(id, e.at);
  }

  return {
    get version() { return version; },

    get(id) {
      const e = entries[id];
      if (!e) return undefined;
      const out = {};
      for (const k of KINDS) if (e[k]) out[k] = e[k];
      return out;
    },

    set(id, kind, value) {
      if (!KINDS.includes(kind)) throw new Error(`unknown kind ${kind}`);
      const e = entries[id] ?? { at: 0 };
      if (value) e[kind] = value;
      else delete e[kind];
      e.at = now();
      if (KINDS.some(k => e[k])) entries[id] = e;
      else delete entries[id];
      version += 1;
      write();
    },

    touch(ids) {
      const t = now();
      let stale = false;
      for (const id of ids) {
        const e = entries[id];
        if (!e) continue;
        e.at = t;
        if (t - (diskAt.get(id) ?? 0) >= DAY_MS) stale = true;
      }
      if (stale) write();
    },
  };
}

export { listIcons, resolveIcon, createSessionIconStore, DAY_MS, KEEP_MS };
