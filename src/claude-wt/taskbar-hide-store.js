/**
 * Явные отметки прятания кнопки сессии (`hide`/`show`), заданные агентом
 * через claude-wt CLI. JSON у службы, ключ — sessionId:
 * `{ mode, hwnd?, sawIdle?, at, setAt? }`. Журнала спрятанных hwnd нет: старт службы
 * возвращает кнопки всем окнам терминалов. Писатель один — служба; файл
 * читается раз при создании. Записи без обновления дольше KEEP_MS
 * выбрасываются при записи. Устройство — как у session-icons.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from '../commands/write-file-atomic.js';

const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const MODES = ['hide', 'show'];

function readEntries(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return Object.create(null);
    const out = Object.create(null);
    for (const [id, e] of Object.entries(data)) {
      if (!e || typeof e !== 'object' || !MODES.includes(e.mode)) continue;
      const entry = { mode: e.mode, at: Number(e.at) || 0 };
      if (Number.isFinite(e.hwnd)) entry.hwnd = e.hwnd;
      if (e.sawIdle === true) entry.sawIdle = true;
      if (Number.isFinite(e.setAt)) entry.setAt = e.setAt;
      out[id] = entry;
    }
    return out;
  } catch {
    return Object.create(null);
  }
}

function createTaskbarHideStore({ file, now = () => Date.now() }) {
  const entries = readEntries(file);
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
  }

  // `at` — последнее обновление (для KEEP_MS), `setAt` — постановка отметки:
  // служебное, в вид отметки не входит.
  const view = (e) => {
    const out = { ...e };
    delete out.at;
    delete out.setAt;
    return out;
  };

  return {
    get version() { return version; },

    get(id) {
      const e = entries[id];
      return e ? view(e) : undefined;
    },

    set(id, mode) {
      if (mode === null) delete entries[id];
      else if (MODES.includes(mode)) entries[id] = { mode, at: now(), setAt: now() };
      else throw new Error(`unknown mode ${mode}`);
      version += 1;
      write();
    },

    patch(id, fields) {
      const e = entries[id];
      if (!e) return;
      Object.assign(e, fields, { mode: e.mode, at: now(), setAt: e.setAt });
      if (e.setAt === undefined) delete e.setAt;
      version += 1;
      write();
    },

    /** Когда отметку поставили (мс, часы службы); у записей старого файла — нет. */
    setAtOf(id) {
      return entries[id]?.setAt;
    },

    ids() { return Object.keys(entries); },

    clearAll() {
      for (const id of Object.keys(entries)) delete entries[id];
      version += 1;
      write();
    },
  };
}

export { createTaskbarHideStore, KEEP_MS };
