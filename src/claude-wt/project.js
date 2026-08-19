import { spawn } from 'node:child_process';
import { focusWindowById, getActiveWindowId, getWindowById, getWindows } from '../windows.js';
import { placeWindowByConfig } from '../placement.js';
import { getMonitorByPoint } from '../monitors.js';
import { toWindowSpace } from '../claude-layout-helpers.js';
import { markNoAutoplace } from '../no-autoplace.js';
import { virtualDesktop } from '../virtual-desktop.js';
import { getClaudeWtConfig, isTerminalWindow } from './index.js';
import { claudeWtSessions } from './view.js';
import { readState } from './state.js';
import { loadSessionIndex } from './sessions.js';
import { resolveSession } from './tracker-helpers.js';
import { stripTitleDecoration } from './title-helpers.js';
import { centerOnMonitor, pickOpenProjectSession, planLaunchNew, planWtLaunch, profileForTerminal, sessionNameFor } from './project-helpers.js';
import { chooseTerminal } from './terminal-helpers.js';
import { waitForNewWindow } from './restore.js';
import { startTiming, noTiming } from './timing.js';

/**
 * Сфокусировать окно терминала, заплатив за столы только если пришлось.
 *
 * Раньше порядок был обратный: спросить у `VirtualDesktop11.exe` стол окна,
 * перейти на него, потом фокус. Два запуска процесса на каждый перевод фокуса —
 * 208 мс замером на popstas-pc, и платились они всегда, даже когда окно и так
 * на текущем столе, то есть почти всегда.
 *
 * Здесь сначала пробуется сам фокус, а потом проверяется, вышло ли: окно стало
 * передним — делать больше нечего, и ни одного процесса не запущено. Проверка
 * бесплатная, и в этом весь трюк: `getActiveWindowId()` — это
 * `GetForegroundWindow()` и ничего больше, тогда как любой вопрос про столы
 * стоит запуска exe. Не вышло — окно на другом столе (фокус на такое Windows
 * отдаёт молча и без результата), и вот тогда переход оправдан.
 *
 * `knownDesktop` (1-based, как хранит слот) снимает и оставшийся вопрос: стол
 * знает тот, кто только что сам поставил туда окно, и спрашивать его у Windows
 * незачем.
 */
async function focusTerminalWindow(windowId, mark = noTiming, knownDesktop = null) {
  if (focusWindowById(windowId) && getActiveWindowId() === windowId) {
    mark('focus');
    return true;
  }
  try {
    const known = Number.isFinite(knownDesktop) && knownDesktop > 0 ? knownDesktop - 1 : null;
    const current = known ?? await virtualDesktop.GetWindowDesktopNumber(windowId);
    if (current !== undefined && current !== null && current !== '') {
      const target = Number(current);
      if (!Number.isNaN(target)) await virtualDesktop.GoToDesktopNumber(target);
    }
  } catch {
    // Focus still worth trying if the desktop query fails.
  }
  mark('desktop');
  const ok = focusWindowById(windowId);
  mark('focus');
  return ok;
}

function terminalWindows() {
  return getWindows().filter(isTerminalWindow);
}

/**
 * Open WT window whose decoration-stripped title equals `title`.
 * Covers the gap before the ccfzf dump catches up and the daemon binds a slot.
 */
function findOpenTerminalByTitle(title) {
  const want = stripTitleDecoration(title);
  if (!want) return null;
  for (const w of terminalWindows()) {
    if (stripTitleDecoration(w.getTitle()) === want) return w;
  }
  return null;
}

// Окно ждём дольше, чем кажется нужным: `wt.exe` рисуется за полсекунды, но
// заголовок ему ставит уже сам `claude -n`, а тот поднимается на удалённой
// машине через ssh. Пятнадцать секунд — с запасом на холодный старт; не нашли
// за это время — значит и не найдём, а не «подождём ещё».
const WINDOW_WAIT_MS = 15000;
const WINDOW_POLL_MS = 250;
// Пауза между появлением окна и фокусом.
//
// Была 4000 мс — ровно столько, чтобы пересидеть обоих, кто двигает окно новой
// сессии: автопостановщик (такт 1.5 с плюс задержка 1 с) и демон claude-wt,
// привязывающий сессию к слоту за два тика и способный увести окно на чужой
// стол. Ждать их приходилось потому, что переход на другой стол оставляет
// передним что придётся, и фокус, взятый раньше переноса, у человека отбирали.
//
// Ждать больше нечего, и потому умолчание — ноль. Демон, уйдя за окном на его
// стол, сам делает это окно передним (см. `claudeWtTick`, ветка `follow`), а
// геометрию слота окно получает здесь же, до фокуса. Ждать «на всякий случай»
// нечего: окно найдено по точному заголовку, а его ставит уже поднявшийся
// `claude`, а не пустая рама, — то есть терминал к этому моменту нарисован.
// Всякое другое число здесь было бы тем же гаданием, от которого эта правка и
// уходит: прежние 4000 мс никто не измерял, а стоили они две трети всей
// задержки.
//
// Страховка на случай, если терминал всё-таки переставит себя после нас,
// двойная и обе не наши: `placeWindow()` повторяет промах, а тик демона
// поставит окно на место, как ставил всегда.
//
// Настройкой, а не константой: цена ошибки — отобранный у человека фокус или
// вернувшийся прыжок окна, и чинить это перевыкаткой кода на живой машине
// незачем.
const PLACEMENT_SETTLE_MS = 0;

/**
 * Пауза из конфига, с откатом на константу.
 *
 * Отказ конфига здесь не повод не фокусировать окно: оно уже открыто и ждёт
 * человека, а всё, чего мы лишаемся, — подобранного числа вместо умолчания.
 * `getClaudeWtConfig()` бросает, когда файла нет вовсе (так и живут тесты, и
 * любая машина без установки), и без этого отката хвост `focusSpawnedWindow`
 * умирал бы в `.catch()` строкой в журнале — окно открылось, фокуса нет.
 */
const settleMsFromConfig = () => {
  try {
    const raw = getClaudeWtConfig().focusSettleMs;
    return Number.isFinite(raw) && raw >= 0 ? raw : PLACEMENT_SETTLE_MS;
  } catch {
    return PLACEMENT_SETTLE_MS;
  }
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Поставить только что открытое окно туда, где эта сессия стояла раньше.
 *
 * Тем же слотом и той же дорогой, что и демон, — но сразу, а не через две
 * секунды. Демону ждать приходится: заголовок при входе в сессию скачет
 * (`shell` → `claude` → имя сессии), и он привязывает окно к слоту только
 * после `stableTicks` одинаковых тиков, иначе окно уехало бы в слот
 * промежуточного заголовка. Здесь ждать нечего: окно найдено по точному
 * заголовку, который мы сами и задали при запуске, — сомнений, чья это
 * сессия, нет вовсе.
 *
 * Ради этого всё и затевалось. Замер на popstas-pc: фокус доходил до окна за
 * 947 мс, а демон двигал и растягивал его на 1.9 с — и вот этот прыжок из
 * терминальской геометрии в свою человек и видел как «окно наконец
 * открылось». Поставленное заранее окно демон на своём тике уже не двигает:
 * `placeWindow()` пропускает то, что и так стоит на месте.
 *
 * Отказ здесь ничего не отменяет: слота может не быть вовсе (сессия с этим
 * именем открывается впервые), состояние может не прочитаться — окно всё
 * равно откроется и получит фокус, просто там, куда его поставил терминал.
 *
 * Ответ — номер стола, на который окно поставлено (1-based, как в слоте), либо
 * `null`. Зовущий передаёт его фокусу, и тот не спрашивает у Windows то, что
 * мы только что сами и сделали.
 */
/**
 * Правило постановки окна на экран под курсором — или `null`.
 *
 * Точку в монитор переводит тот же `getMonitorByPoint`, каким это делают
 * раскладки: пикер номера экрана не называет и назвать не может — нумераций у
 * нас три сразу (своя в конфиге, hMonitor и FancyZones), и договариваться о
 * какой-то одной через два репозитория значило бы завести расхождение, которое
 * не видно ниоткуда. Точка же однозначна.
 *
 * Незнакомая точка — `null`, а не главный монитор: она означает, что конфиг
 * мониторов разошёлся с тем, что видит пикер, и ставить окно наугад тут хуже,
 * чем оставить его там, куда его положил терминал.
 *
 * Размер: от слота, если тот помнит, иначе тот, с которым окно открылось. Без
 * `width`/`height` в правиле `placeWindow` подставил бы их сам из старых
 * границ, но тогда переезд между экранами с разным масштабом остался бы без
 * поправки (`adjustBoundsForScale` смотрит на то, назван ли размер).
 *
 * **Два пространства координат, и складывать их напрямую нельзя** — раздел
 * «FancyZones coordinate system & DPI gotchas» в AGENTS.md, где это уже дважды
 * ломало расстановку. `Monitor.getWorkArea()` отдаёт числа как есть, а
 * `Window.getBounds()`/`setBounds()` делят и умножают их на масштаб монитора
 * окна. Значит рабочая область переводится в пространство окна тем же
 * `toWindowSpace`, каким это делает `layoutWorkArea` у раскладок: без перевода
 * окно на мониторе с масштабом считалось бы в мониторных пикселях и уезжало бы
 * к соседу — ровно та поломка, что уже была у плитки.
 *
 * Область — рабочая, а не полные границы: панель задач съедает низ экрана, и
 * центр по полным границам увёл бы окно вниз на половину её высоты.
 */
function cursorRule({ win, cursor, slot, monitorAt = getMonitorByPoint }) {
  const mon = monitorAt(cursor);
  // `isPrimary()` есть у настоящего монитора; отсутствие метода читается как
  // «главный», то есть как отказ от пометки — сторона осторожная: лишняя
  // пометка выключила бы человеку расстановку там, где он её ждёт.
  const primary = !mon?.isPrimary || mon.isPrimary();
  const area = mon && toWindowSpace(
    mon.getWorkArea ? mon.getWorkArea() : mon.bounds,
    mon.getScaleFactor ? mon.getScaleFactor() : 1,
  );
  if (!area?.width) {
    console.error(`[claude-wt] no monitor at ${cursor.x},${cursor.y}`);
    return null;
  }
  const size = slot?.bounds ?? win.getBounds();
  if (!size?.width || !size?.height) return null;
  const at = centerOnMonitor(area, size);
  const rule = { window: win.id, x: at.x, y: at.y, width: size.width, height: size.height };
  console.log(`[claude-wt] cursor ${cursor.x},${cursor.y} -> ${JSON.stringify(rule)}`);
  return { rule, primary };
}

/**
 * Поставить окно по правилу и, если экран не главный, закрыть его от автоматики.
 *
 * Пометка только для неглавного экрана — так просил человек, и оговорка не
 * лишняя: на главном экране правила из `config.windows` и память слотов делают
 * ровно то, чего от них ждут, а выключенная там расстановка выглядела бы
 * поломкой конфига.
 *
 * Ставится **после** удачной постановки: помеченное, но не переехавшее окно
 * осталось бы и на прежнем месте, и без расстановки — худшее из двух.
 */
async function placeByCursor(target, place, what) {
  if (!target) return false;
  try {
    await place(target.rule);
  } catch (e) {
    console.error(`[claude-wt] failed to place ${what}: ${e.message}`);
    return false;
  }
  if (!target.primary) markNoAutoplace(target.rule.window);
  return true;
}

/**
 * Поставить окно на экран под курсором — без всякой памяти о прежнем месте.
 *
 * Отдельно от `placeSpawnedWindow` ровно потому, что та начинает с поиска
 * слота, а здесь искать нечего.
 */
async function placeAtCursor(win, cursor, deps = {}) {
  const { place = placeWindowByConfig, monitorAt = getMonitorByPoint } = deps;
  return placeByCursor(cursorRule({ win, cursor, slot: null, monitorAt }), place, 'a new window');
}

async function placeSpawnedWindow(win, title, mark = noTiming, cursor = null, deps = {}) {
  const { place = placeWindowByConfig, monitorAt = getMonitorByPoint } = deps;
  let slot = null;
  try {
    const cfg = getClaudeWtConfig();
    const state = readState(cfg.statePath);
    const sessionIndex = loadSessionIndex(cfg.sessionsFile, cfg.progressDir);
    const resolved = resolveSession(stripTitleDecoration(title), sessionIndex, state.slots);
    slot = resolved ? state.slots[resolved.id] : null;
  } catch (e) {
    console.error(`[claude-wt] no remembered place for ${title}: ${e.message}`);
  }
  mark('slot');
  // Курсор главнее памяти о месте, и это решение. Слот — где окно этой сессии
  // стояло когда-то; курсор — куда человек попросил прямо сейчас, включив
  // галку и поставив мышь. Явная сегодняшняя просьба обязана перебивать
  // вчерашнюю неявную, иначе галка работала бы только у сессий, которых эта
  // машина ещё не видела, — то есть через раз и необъяснимо.
  //
  // Размер при этом остаётся от слота, если слот есть: переезд на соседний
  // экран — это про экран, а не про то, чтобы забыть, каким окно было.
  const target = cursor
    ? cursorRule({ win, cursor, slot, monitorAt })
    : slot?.bounds && { rule: { window: win.id, ...slot.bounds }, primary: true };
  if (!target) return null;
  if (slot?.desktop) target.rule.desktop = slot.desktop;
  if (!(await placeByCursor(target, place, title))) return null;
  mark('place');
  return target.rule.desktop ?? null;
}

/**
 * Дождаться окна только что запущенной сессии и сфокусировать его.
 *
 * Зачем это вообще нужно: `wt.exe` запускает фоновый процесс службы MQTT, а
 * Windows отдаёт передний план только процессу, который им уже владеет либо
 * получил последнее событие ввода. Новый терминал — ни то, ни другое, и его
 * окно то открывается за чужими, то вовсе оказывается свёрнутым; выглядит это
 * случайным, потому что случайно и есть — гонка с тем, кто в этот момент
 * владеет передним планом. Здесь окно поднимают явно, и это работает без
 * всякой грамоты: `bringToTop()` в node-window-manager подцепляет свой ввод к
 * потоку переднего окна (`AttachThreadInput`), а такой подъём Windows не
 * запрещает.
 *
 * Фокус идёт через `focusTerminalWindow`, а не через голый `focusWindowById`:
 * демон к этому моменту мог увести окно на стол слота, а фокус на окне с
 * чужого стола Windows отдаёт молча и без результата.
 *
 * Зависимости — аргументами: без них проверить можно было бы только настоящие
 * четыре секунды ожидания.
 */
async function focusSpawnedWindow(title, deps = {}) {
  const {
    findWindow = findOpenTerminalByTitle,
    focus = focusTerminalWindow,
    wait = sleep,
    now = Date.now,
    waitMs = WINDOW_WAIT_MS,
    pollMs = WINDOW_POLL_MS,
    settleMs = settleMsFromConfig(),
    place = placeSpawnedWindow,
    mark = noTiming,
    cursor = null,
  } = deps;
  const deadline = now() + waitMs;
  let w = findWindow(title);
  while (!w && now() < deadline) {
    await wait(pollMs);
    w = findWindow(title);
  }
  if (!w) {
    mark('window:not-found');
    return false;
  }
  mark('window');
  await wait(settleMs);
  mark('settle');
  // Место — раньше фокуса: окно, которое сначала получает ввод, а через
  // секунду прыгает в свою геометрию, человек читает как «открылось только
  // сейчас», и вся экономия предыдущих звеньев пропадает зря.
  const desktop = await place(w, title, mark, cursor);
  return focus(w.id, mark, desktop);
}

/**
 * Поднять окно, которого не было до запуска.
 *
 * Отличается от `focusSpawnedWindow` тем, чего у зовущего нет: заголовка.
 * Просьба открыть сессию несёт только `id` и каталог, а заголовок ставит уже
 * сам `claude` на той стороне ssh. Зато запуск здесь ровно один, и «окно, чьего
 * hwnd не было среди терминалов минуту назад» означает наше окно однозначно —
 * тем же признаком ловит окна `launchPlan` при восстановлении.
 *
 * Пауза перед фокусом — та же и по той же причине, что в `focusSpawnedWindow`:
 * за неё успевают автопостановщик и демон, а фокус, взятый раньше них, у
 * человека отберут.
 */
async function focusNewTerminalWindow(knownIds, deps = {}) {
  const {
    waitForWindow = waitForNewWindow,
    focus = focusTerminalWindow,
    wait = sleep,
    waitMs = WINDOW_WAIT_MS,
    settleMs = settleMsFromConfig(),
    mark = noTiming,
    cursor = null,
    placeAt = placeAtCursor,
  } = deps;
  const win = await waitForWindow(knownIds, waitMs);
  if (!win) {
    mark('window:not-found');
    return false;
  }
  mark('window');
  await wait(settleMs);
  mark('settle');
  // Не `placeSpawnedWindow`: та начинает с поиска слота по заголовку, а
  // заголовка здесь нет вовсе (его ставит уже сам `claude` на той стороне
  // ssh) — и поиск сходил бы на сетевой диск за списком сессий ради
  // заведомого промаха. Слота у такой сессии и не бывает: эта машина видит
  // её впервые.
  if (cursor) await placeAt(win, cursor);
  return focus(win.id, mark);
}

/**
 * Поднять **эту** сессию по её id — ту самую, а не новую в её каталоге.
 *
 * Нужна там, где `restoreClaudeSessions` бессильна: та поднимает сессию по
 * слоту (`state.slots`), то есть только ту, чьё окно эта машина когда-то
 * видела. Список пикера приезжает от ccfzf со ssh-хоста и знает сессии, чьи
 * окна стоят на другой машине или закрыты вовсе; попросить открыть такую
 * здесь — обычное дело, а слота у неё нет и не было. Раньше просьба падала в
 * ветку «известен каталог» и человек получал пустую `claude -n` вместо своей
 * сессии, причём молча: у публикации в MQTT ответа нет.
 *
 * Резюмировать есть чем: `claudeWt.launch.args` — тот же шаблон
 * `ccfzf --session {id} --kiosk`, которым восстановление возвращает сессию
 * после падения машины. Профиль терминала даёт каталог (`profileForTerminal`),
 * и он приезжает в теле просьбы — собранная в пикере команда `wt.exe` профиля
 * не знает.
 *
 * Геометрии здесь нет и взяться ей неоткуда: слот — это память о прежнем месте
 * окна, а его-то и нет. Окно встаёт туда, куда его поставит терминал; дальше
 * его подхватят автопостановщик и демон, который тут же заведёт слот — и
 * следующий подъём этой сессии пойдёт уже прежней дорогой.
 *
 * Зависимости — вторым аргументом: без них проверять пришлось бы настоящим
 * запуском терминала.
 */
async function resumeClaudeSession({ id, cwd = '', terminal, cursor = null } = {}, deps = {}) {
  const {
    cfg = getClaudeWtConfig(),
    spawnProcess = spawn,
    listWindows = terminalWindows,
    focusNew = focusNewTerminalWindow,
  } = deps;
  const sessionId = typeof id === 'string' ? id.trim() : '';
  if (!sessionId) return { ok: false, reason: 'id is required' };
  const mark = deps.mark ?? startTiming(`resume ${sessionId}`);
  // Блок `launch`, а не `launchNew`: здесь собирается возобновление сессии, и
  // старость конфига судится по тому блоку, из которого берётся шаблон.
  const { chosen, message } = chooseTerminal(terminal, cfg, 'launch');
  if (message) console.error(message);
  const { command, args } = planWtLaunch({
    launch: cfg.launch,
    vars: { id: sessionId },
    profile: profileForTerminal(cwd, chosen.name, cfg),
    terminal: chosen.entry,
  });
  if (!command) {
    return { ok: false, reason: 'claudeWt: no terminal named by the request or the config' };
  }
  // Список окон снимается до запуска: после него новое окно уже не отличить.
  const known = new Set(listWindows().map(w => w.id));
  mark('windows-list');
  try {
    spawnProcess(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    return { ok: false, action: 'spawn', reason: e.message };
  }
  mark('spawn');
  // Хвостом, как у `openClaudeProject`, и `.catch()` по той же причине:
  // необработанное отклонение роняет процесс, в котором живут экспорт в Home
  // Assistant и сторож демона.
  focusNew(known, { ...deps, mark, cursor }).catch((e) => {
    console.error(`[claude-wt] failed to focus ${sessionId}: ${e.message}`);
  });
  return { ok: true, action: 'resume', sessionId };
}

/**
 * Focus the last open Claude session for a project cwd, or spawn a fresh
 * `claude -n <name>` there when none is on screen — `<name>` defaults to
 * `basename(cwd)`, but at `reuseOpen: false` it comes straight from the
 * request body instead (see below).
 *
 * `reuseOpen: false` — «заведи ещё одну»: оба поиска пропускаются, и терминал
 * открывается всегда. Просьба приходит от `^N` в ccfzf-picker, где человек
 * нажимает её именно потому, что сессия уже есть и нужна вторая. Умолчание
 * `true` оставляет проектный хоткей и Enter прежними.
 *
 * Ответ возвращается сразу после `spawn`, но работа на этом не кончается:
 * окно новой сессии поднимает `focusSpawnedWindow` отдельным хвостом — см.
 * его докстроку о том, почему без этого терминал открывается за чужими окнами
 * или свёрнутым. Найденное окно (обе ветки `focus*`) поднимается на месте:
 * там ждать нечего, окно уже стоит там, где стояло.
 *
 * @param {{ cwd: string, name: string, profile?: string, reuseOpen?: boolean, terminal?: string, cursor?: {x: number, y: number} | null }} opts
 * @returns {Promise<{ ok: boolean, action?: string, reason?: string, sessionId?: string, sessionName?: string }>}
 */
async function openClaudeProject({ cwd, name, profile, reuseOpen = true, terminal, cursor = null } = {}) {
  if (typeof cwd !== 'string' || !cwd || typeof name !== 'string' || !name) {
    return { ok: false, reason: 'cwd and name are required' };
  }
  const sessionName = sessionNameFor({ cwd, name, reuseOpen });
  const mark = startTiming(`open ${sessionName}`);

  // Просьбе «заведи ещё одну» оба поиска не нужны и вредны: первый поднял бы
  // ту самую сессию, рядом с которой просят открыть новую, а второй — её окно
  // по заголовку. Заодно не читается список сессий, а он ходит на сетевой диск.
  //
  // `brief: true` — по той же причине, только для тех просьб, где список всё же
  // нужен: состояние агента здесь ни на что не влияет, а читается дольше всего
  // остального вместе взятого (замер: 1.43 с из 1.47 с до spawn).
  if (reuseOpen) {
    let res;
    try {
      res = claudeWtSessions({ mark, brief: true });
    } catch (e) {
      return { ok: false, reason: e.message };
    }
    if (!res.ok) return { ok: false, reason: res.reason };

    const session = pickOpenProjectSession(res.sessions, cwd);
    if (session?.windowId && getWindowById(session.windowId)) {
      if (!(await focusTerminalWindow(session.windowId, mark))) {
        return { ok: false, action: 'focus', reason: 'window is not on screen', sessionId: session.id };
      }
      return { ok: true, action: 'focus', sessionId: session.id };
    }

    const byTitle = findOpenTerminalByTitle(sessionName);
    mark('by-title');
    if (byTitle) {
      if (!(await focusTerminalWindow(byTitle.id, mark))) {
        return { ok: false, action: 'focus-title', reason: 'window is not on screen' };
      }
      return { ok: true, action: 'focus-title', sessionName };
    }
  }

  const cfg = getClaudeWtConfig();
  // Судим по launchNew, а не по launch: отсюда и собирается команда ниже, и
  // старость чужого блока (`launch`, крэш-восстановление) её не касается —
  // полумигрированный конфиг иначе давал либо удвоенные аргументы, либо
  // ложный отказ (см. isLegacyLaunch).
  const { chosen, message } = chooseTerminal(terminal, cfg, 'launchNew');
  if (message) console.error(message);
  const effectiveProfile = profile ?? profileForTerminal(cwd, chosen.name, cfg);
  const { command, args } = planLaunchNew({
    launchNew: cfg.launchNew,
    cwd,
    name: sessionName,
    profile: effectiveProfile,
    terminal: chosen.entry,
  });
  if (!command) {
    return { ok: false, reason: 'claudeWt: no terminal named by the request or the config' };
  }
  mark('plan');
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch (e) {
    return { ok: false, action: 'spawn', reason: e.message };
  }
  mark('spawn');
  // Хвостом, а не до ответа: окно появится через секунды, а просьба должна
  // вернуться сразу — её ждёт обработчик MQTT, который пишет в журнал исход.
  // `.catch()` обязателен: необработанное отклонение в node 22 роняет процесс
  // целиком, а в нём же живут экспорт в Home Assistant и сторож демона.
  // Курсор доезжает сюда из тела просьбы: экран для нового окна называет
  // пикер — он один знает, где сейчас смотрит человек. Ветки подъёма выше его
  // не касаются вовсе: просьба про новое окно, а уже открытое никуда не едет.
  focusSpawnedWindow(sessionName, { mark, cursor }).catch((e) => {
    console.error(`[claude-wt] failed to focus ${sessionName}: ${e.message}`);
  });
  return { ok: true, action: 'spawn', cwd, name: sessionName, sessionName };
}

// `cursorRule` вынесена в экспорт ради сторожа: поведением её не поймать —
// правило уходит в `setBounds`, а окно на неверном экране видно только
// глазами и только на машине с двумя мониторами.
export { openClaudeProject, resumeClaudeSession, focusSpawnedWindow, focusNewTerminalWindow, focusTerminalWindow, cursorRule };
