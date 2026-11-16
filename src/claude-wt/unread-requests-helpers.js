/**
 * Просьбы «вернуть в непрочитанное» от службы к демону. Без I/O.
 *
 * Зачем файл. `claude-session-unread` приходит в служебный процесс
 * (`node src/index.js mqtt`), а слоты с `focusedAt` держит в памяти демон —
 * другой процесс (`claude-wt watch`). Правка state-файла из службы не доживала:
 * демон его не перечитывает, переписывает раз в секунду (у слотов растёт
 * `lastSeen`) и публикует в файл окон свой прежний `focusedAt`, а пикер берёт
 * максимум из своей и трекерной отметки — строка оставалась «прочитанной».
 * Поэтому служба кладёт просьбу в файл рядом с состоянием, а демон читает его по
 * mtime на каждом тике — тот же приём, что у `window-icons.json`.
 *
 * Файл: `{ requests: [{ at, ids, unreadAt }] }`, `at` — миллисекунды просьбы,
 * по нему демон отличает новые от уже применённых. Хранится хвост последних
 * `MAX_REQUESTS`: демон читает файл каждую секунду, и старые просьбы ему не
 * нужны, а расти файлу незачем.
 */

const MAX_REQUESTS = 20;

function unreadSidecarPath(statePath) {
  const file = statePath ?? '';
  const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  if (slash < 0) return '';
  return `${file.slice(0, slash)}/unread-requests.json`;
}

function normalizeRequests(raw) {
  const list = Array.isArray(raw?.requests) ? raw.requests : [];
  return list.filter(r => r && Number.isFinite(r.at) && Array.isArray(r.ids)
    && r.ids.every(id => typeof id === 'string') && Number.isFinite(r.unreadAt));
}

/** Дописать просьбу к прочитанному содержимому файла (или к `null`). */
function appendUnreadRequest(raw, request, max = MAX_REQUESTS) {
  const requests = [...normalizeRequests(raw), request];
  return { requests: requests.slice(-max) };
}

/**
 * Что применить из файла: просьбы новее `sinceMs`. Отметки по одной сессии
 * складываются последней по времени просьбы — так же, как легли бы подряд.
 *
 * @returns {{ marks: Record<string, number>, ids: string[], lastAt: number }}
 */
function freshUnreadRequests(raw, sinceMs) {
  const fresh = normalizeRequests(raw).filter(r => r.at > sinceMs).sort((a, b) => a.at - b.at);
  const marks = {};
  for (const r of fresh) for (const id of r.ids) marks[id] = r.unreadAt;
  return { marks, ids: Object.keys(marks), lastAt: fresh.length ? fresh.at(-1).at : sinceMs };
}

export { MAX_REQUESTS, unreadSidecarPath, appendUnreadRequest, freshUnreadRequests };
