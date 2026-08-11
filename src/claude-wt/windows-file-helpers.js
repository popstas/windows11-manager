/** Pure helpers for the published windows file. No external I/O. */

// Как часто файл переписывается, когда расклад не менялся. Свежесть читатель
// судит по полю `generated` и только по нему: mtime не отличает «демон умер» от
// «ничего не менялось», а разница между этими случаями — вся суть файла. Без
// сердцебиения `generated` залипал бы у здорового демона, и читатель погасил бы
// пометки об окнах, которые открыты.
const WINDOWS_FILE_HEARTBEAT_MS = 30_000;

/**
 * Опубликованный вид: у какой сессии сейчас открыто окно и на каком столе.
 *
 * Берётся из окон текущего тика, а не из слотов состояния. Слот переживает
 * закрытие окна — он затем и заведён, чтобы вернуть сессию на прежнее место, —
 * так что по слотам файл рассказывал бы про окна, которых на экране нет.
 * Стол и `lastSeen` при этом всё равно из слота: в окне тика их не бывает.
 *
 * `pid` — не диагностика, а рабочее поле. Windows отдаёт передний план только
 * тому, кто им уже владеет либо получил последнее событие ввода; демон — ни то,
 * ни другое, и право ему передаёт читатель вызовом AllowSetForegroundWindow на
 * этот pid. Без него подъём окна отчитается об успехе, а на экране мигнёт
 * кнопка на таскбаре — отказ невидим с обеих сторон.
 *
 * `host` отвечает читателю на вопрос «моя ли это машина»: поднимать окно на
 * чужом экране бессмысленно, а знать, что оно есть, полезно везде.
 *
 * `focusedAt` — отметка «человек посмотрел на это окно», из которой здесь
 * считается `agentSeen`. Своей у читателя нет и быть не может: окон он не
 * видит, и без этой его список продолжал бы звать к сессии, на которую уже
 * сходили руками.
 */
function buildWindowsFile({ windows, slots, host, pid, nowMs, snapshots, projects }) {
  const out = {};
  for (const w of windows ?? []) {
    const id = w?.sessionId;
    if (typeof id !== 'string' || !id) continue;
    const slot = (slots ?? {})[id];
    out[id] = {
      title: typeof w.title === 'string' ? w.title : '',
      desktop: Number.isFinite(slot?.desktop) ? slot.desktop : null,
      lastSeen: Number.isFinite(slot?.lastSeen) ? slot.lastSeen : 0,
      focusedAt: Number.isFinite(slot?.focusedAt) ? slot.focusedAt : 0,
    };
  }
  // Секунды, а не миллисекунды: рядом лежит `lastSeen` в секундах, и читатель —
  // python на другой машине, которому проще сравнивать с time.time().
  return {
    host, pid, generated: Math.floor(nowMs / 1000), windows: out,
    // Ключ на месте всегда, даже пустой: читателю дешевле пустой массив, чем
    // проверка на отсутствие ключа при каждом использовании.
    snapshots: (snapshots ?? []).map(trimSnapshot),
    // Хоткеи проектов. Единственный их источник — claudeWt.projects здесь;
    // регистрирует клавиши читатель (ccfzf-picker) на своей стороне, и знать
    // про них ему больше неоткуда. Записи без хоткея не едут: список проектов
    // читатель собирает сам, а сказать ему нечего.
    //
    // `profile` не едет намеренно: это знание про Windows Terminal на этой
    // машине, читателю бесполезное.
    projects: (projects ?? [])
      .filter(p => typeof p?.hotkey === 'string' && p.hotkey.trim())
      .map(p => ({
        cwd: typeof p.cwd === 'string' ? p.cwd : '',
        name: typeof p.name === 'string' ? p.name : '',
        hotkey: p.hotkey.trim(),
      })),
  };
}

/**
 * Обрезанный вид снимка для читателя на той стороне.
 *
 * `bounds`, `desktop` и `monitor` остаются в файле снимков: их читает
 * восстановление, а оно работает на этой же машине. Читателю они не нужны, а
 * ехали бы в каждом ответе агрегатора, раз в секунду.
 */
function trimSnapshot(snap) {
  return {
    id: typeof snap?.id === 'string' ? snap.id : '',
    created: Number.isFinite(snap?.created) ? snap.created : 0,
    sessions: (snap?.sessions ?? []).map(s => ({
      id: typeof s?.id === 'string' ? s.id : '',
      title: typeof s?.title === 'string' ? s.title : '',
      cwd: typeof s?.cwd === 'string' ? s.cwd : '',
    })),
  };
}

/**
 * Что в файле изменилось бы содержательно.
 *
 * Заголовок входит наравне с составом и столами: он приходит уже очищенным от
 * украшений статуса (stripTitleDecoration), поэтому меняется на смену проекта
 * или имени сессии, а не на каждый ход агента.
 *
 * `focusedAt` входит туда же, и это не бесплатно: переход фокуса на окно
 * сессии заставляет переписать файл. Иначе отметка о взгляде ждала бы
 * сердцебиения — до тридцати секунд, — и у читателя кружок гас бы через
 * полминуты после того, как на сессию сходили, а возврат в непрочитанное
 * ровно столько же держался бы погашенным. Переходов фокуса немного, и они
 * и так двигают состояние на диске.
 *
 * Второй аргумент, снимки, входит по составу (`id` + `created`), а не по
 * содержимому сессий: снимок неизменяем, кроме последнего, которому
 * snapshotTick правит координаты, — а координаты в файл трекера всё равно не
 * едут. Без этого запись снимка доезжала бы до читателя только
 * сердцебиением, до тридцати секунд.
 */
function windowsFingerprint(windows, snapshots, projects) {
  const win = Object.entries(windows ?? {})
    .map(([id, w]) => `${id}\u0000${w.desktop}\u0000${w.title}\u0000${w.focusedAt}`)
    .sort()
    .join('\u0001');
  // Состав, не содержимое: снимок неизменяем, кроме последнего, которому тик
  // правит координаты, — а координаты в файл трекера не едут вовсе. Без
  // этого запись снимка доезжала бы до читателя только сердцебиением, до
  // тридцати секунд.
  const snaps = (snapshots ?? [])
    .map(s => `${s?.id} ${s?.created}`)
    .join('');
  // Хоткеи входят по содержимому целиком: их мало, а смена клавиши в конфиге
  // обязана доехать до читателя тем же тиком, а не сердцебиением.
  const keys = (projects ?? [])
    .map(p => `${p?.cwd}\u0000${p?.hotkey}`)
    .join('\u0001');
  const tail = `${snaps}${keys ? `\u0002${keys}` : ''}`;
  return tail ? `${win}${tail}` : win;
}

function shouldWriteWindowsFile({ fingerprint, lastFingerprint, lastWriteMs, nowMs }) {
  if (!lastWriteMs) return true;
  if (fingerprint !== lastFingerprint) return true;
  return nowMs - lastWriteMs >= WINDOWS_FILE_HEARTBEAT_MS;
}

export {
  WINDOWS_FILE_HEARTBEAT_MS,
  buildWindowsFile,
  windowsFingerprint,
  shouldWriteWindowsFile,
};
