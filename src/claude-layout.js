/**
 * Раскладки окон Claude: просьба `claude-place` от пикера и панели.
 *
 * Здесь только то, что ходит наружу — зоны FancyZones, мониторы, список
 * сессий, движение окон. Вся арифметика в claude-layout-helpers.js, и её
 * тесты гоняются на машине без node-window-manager.
 */
import { getConfig } from './config.js';
import { fancyZonesToPos } from './fancyzones.js';
import { getMonitorByPoint, getPrimaryMonitor } from './monitors.js';
import { focusWindowById, getActiveWindowId, getWindowById } from './windows.js';
import { isMinimized } from './windows-helpers.js';
import { placeWindow } from './placement.js';
import { claudeWtSessions } from './claude-wt/view.js';
import { virtualDesktop } from './virtual-desktop.js';
import { orderSessions } from './claude-wt/ha/session-slots.js';
import { normalizeSort } from './claude-wt/ha/session-groups.js';
import { arrange, groupByDesktop, pickFocusTarget, toWindowSpace } from './claude-layout-helpers.js';
import { startTiming } from './claude-wt/timing.js';

/**
 * Зоны из `claudeWt.tileZones`, разрешённые в прямоугольники.
 *
 * Пусто значит «считай своей сеткой», и об этом всегда есть строка warn (кроме
 * каскада — там своей сетки нет вовсе, и эта строка была бы враньём):
 * протухший editor-parameters.json — известная болезнь этого проекта
 * (AGENTS.md, «Known issues»), и тихий откат спрятал бы её — окна просто
 * встали бы не туда, а человек искал бы причину в зонах.
 *
 * То же самое, если зона задана, но не разрешилась (битый editor-parameters.json
 * посреди списка): хвост строки warn зависит от режима — у плитки есть своя
 * сетка (tileGrid), у каскада её нет, и он всегда считает от рабочей области
 * главного монитора независимо от tileZones. Строка ровно одна на зону: если
 * `fancyZonesToPos()` бросил, вторую, из ветки «не разрешилась», не пишем —
 * `rect` там всё равно останется `undefined` теми же корнями, что и в catch.
 *
 * `fancyZonesToPos()` зовётся под try: сам разбор `false` в деструктуризации
 * не бросает (боксится как булево), но `getFancyZoneInfo()` внутри читает и
 * парсит `applied-layouts.json`/`custom-layouts.json`, а `getFancyZoneMonitor()`
 * — `editor-parameters.json`; отсутствующий или битый файл роняет JSON.parse
 * или fs.readFileSync, и вот это как раз бросает.
 */
function resolveZones(log, mode) {
  const list = getConfig()?.claudeWt?.tileZones;
  if (!Array.isArray(list) || !list.length) {
    if (mode !== 'cascade') {
      log('claude-place: claudeWt.tileZones не задан — считаю своей сеткой', 'warn');
    }
    return [];
  }
  // Хвост сообщения зависит от режима: у плитки при отказе есть своя сетка
  // (tileGrid по рабочей области), а у каскада её нет вовсе — он всегда
  // считает от рабочей области главного монитора, зоны ему не указ.
  const fallbackTail = mode === 'cascade'
    ? 'раскладываю по рабочей области главного монитора'
    : 'считаю своей сеткой';
  const rects = [];
  for (const zone of list) {
    let rect;
    try {
      rect = fancyZonesToPos(zone);
    } catch (e) {
      // Один log(), не два: rect остаётся undefined, и без return сюда же
      // упала бы вторая, лишняя строка из ветки «не разрешилась» ниже.
      log(`claude-place: зона ${JSON.stringify(zone)} — ${e.message}, ${fallbackTail}`, 'warn');
      return [];
    }
    if (!rect) {
      log(`claude-place: зона ${JSON.stringify(zone)} не разрешилась — ${fallbackTail}`, 'warn');
      return [];
    }
    rects.push(rect);
  }
  return rects;
}

/**
 * Рабочая область — экран без панели задач, `MONITORINFO.rcWork`, переведённая
 * из физических пикселей монитора в логические, в которых живут окна (см.
 * комментарий у деления на `mon.getScaleFactor()` внутри).
 *
 * Монитор ищется по прямоугольнику первой зоны, а не по её номеру: номер в
 * tileZones — номер монитора FancyZones (getSortedMonitors по
 * editor-parameters.json), а getMons() нумерует по config.monitors. Это две
 * разные нумерации, и сводить их здесь — заводить третье место, где они
 * разойдутся.
 *
 * Обёрнуто в try: getMonitorByPoint() зовёт getMons(), а тот лезет в
 * config.monitors[n] без защиты — если в конфиге задан monitorsSize без
 * monitors, это TypeError, а не «не нашёл». Не поймать его здесь — значит
 * уронить всю команду unhandled rejection вместо контрактного { ok: false }.
 * Откат на главный монитор — как и откат на свою сетку в resolveZones() —
 * всегда со строкой warn: без неё протухший editor-parameters.json (точка
 * зоны мимо любого mon.bounds) увозит окна на другой экран молча.
 *
 * У плитки с уже разрешёнными зонами результат этой функции вообще не нужен
 * — tileByZones() кладёт окна прямо в зоны, а не в рабочую область. Поэтому
 * эту функцию для такого случая не зовут вовсе (см. arrangeClaudeWindows()):
 * иначе даже безобидный промах мимо монитора писал бы сюда ложные строки
 * warn про «главный», хотя по главному ничего бы не считалось.
 *
 * Возврат не только `null`, но и вырожденный прямоугольник — самостоятельная
 * дыра: `{width:0,height:0}` истинный, внешняя проверка на `!work` его
 * пропускает, а tileGrid()/cascade() тихо отдают `[]` по своей проверке
 * `work.width <= 0`. Снаружи это выглядело бы как «разложено 0 из N» без
 * единой строки warn — ровно то молчание, которое проект запрещает. Поэтому
 * здесь же, при выходе, проверяются оба измерения.
 */
function layoutWorkArea(rects, log) {
  let mon;
  try {
    mon = rects[0] && getMonitorByPoint(rects[0]);
  } catch (e) {
    log(`claude-place: определить монитор по зоне не удалось — считаю по главному (${e.message})`, 'warn');
    mon = null;
  }
  if (!mon) {
    if (rects[0]) {
      log('claude-place: монитор по зоне не найден — считаю по главному', 'warn');
    }
    try {
      mon = getPrimaryMonitor();
    } catch (e) {
      log(`claude-place: не удалось определить главный монитор — ${e.message}`, 'warn');
      return null;
    }
  }
  if (!mon) {
    log('claude-place: главный монитор не определён — раскладывать не по чему', 'warn');
    return null;
  }
  let work;
  try {
    const raw = mon.getWorkArea?.() ?? mon.bounds ?? null;
    // getWorkArea()/bounds отдают значения как есть (vendor/node-window-manager/
    // src/classes/monitor.ts) — то же пространство, что и editor-parameters.json
    // FancyZones. tileGrid()/cascade() ниже считают геометрию окон, а окна
    // двигаются через getBounds()/setBounds() node-window-manager, и эта
    // пара — не витрина монитора, а отдельное пространство: обёртка
    // (vendor/node-window-manager/src/classes/window.ts) делит сырые
    // координаты на масштаб СВОЕГО монитора при чтении и умножает при записи.
    // Без этого деления на мониторе со 125% сетка строила окно высотой 1728
    // там, где для окон экран высотой 1382 — лишние 346 точек уезжали на
    // соседний монитор снизу (реальный баг, из-за которого всё это чинится).
    // Числа с живой машины popstas-pc: рабочая область монитора 2893x1728 при
    // масштабе 1.25 даёт пространство окон 2314x1382 — именно в нём и должны
    // жить окна. toWindowSpace() (claude-layout-helpers.js) — та же формула,
    // что и в обёртке, вынесенная в чистую функцию ради теста. Деление второй
    // раз не случается: placeWindow() зовёт adjustBoundsForScale(), но при
    // заданных width/height (а arrange() их всегда задаёт) он возвращает
    // bounds нетронутыми (src/scale.js).
    //
    // На неглавном мониторе здесь та же неподтверждённая гипотеза, что и у зон
    // FancyZones (см. AGENTS.md, раздел «FancyZones coordinate system & DPI
    // gotchas», «Possible trap on a non-primary monitor»): не проверено на
    // живой машине, масштабируется ли этот монитор по своему коэффициенту или
    // по коэффициенту главного. Запасная сетка и каскад на нём могут уехать
    // так же, как подозревались зоны.
    const scale = mon.getScaleFactor?.() ?? 1;
    work = toWindowSpace(raw, scale);
  } catch (e) {
    log(`claude-place: не удалось получить рабочую область монитора — ${e.message}`, 'warn');
    return null;
  }
  if (!work || !(work.width > 0) || !(work.height > 0)) {
    log('claude-place: рабочая область монитора вырождена — раскладывать не по чему', 'warn');
    return null;
  }
  return work;
}

/**
 * Окна, которые надо разложить, в порядке раскладки.
 *
 * `ids` пуст — все открытые сессии порядком этой машины, тем же, каким она
 * рисует панель. `ids` задан — порядок просящего: пикер видит свой список и
 * ждёт, что раскладка ляжет его чередой. Ненайденный id пропускается со
 * строкой в журнал: сессия закрыта или живёт на другой машине, и отменять из-за
 * неё всю просьбу незачем.
 *
 * Оттуда же и `brief`. Со своим порядком (`ids` задан — а его задаёт пикер,
 * то есть почти всегда) список нужен лишь затем, чтобы перевести id в hwnd, и
 * состояние агента в этом не участвует; читается же оно с сетевого диска
 * файлом на сессию и стоит больше секунды. Без `ids` порядок считает эта
 * машина, а `compareSessions` сортирует по `lastActivity` — та берётся из
 * прогресса, и краткое чтение переставило бы окна. Поэтому не «всегда
 * кратко», а «кратко там, где порядок пришёл готовым».
 */
function pickWindows(ids, log, mark = () => 0) {
  let res;
  try {
    res = claudeWtSessions({ mark, brief: ids.length > 0 });
  } catch (e) {
    return { error: e.message };
  }
  if (!res.ok) return { error: res.reason };
  const open = res.sessions.filter(s => s.open && s.windowId);
  let chosen;
  if (ids.length) {
    chosen = [];
    for (const id of ids) {
      const session = open.find(s => s.id === id);
      if (!session) {
        log(`claude-place: сессия ${id} здесь не открыта — пропущена`, 'warn');
        continue;
      }
      chosen.push(session);
    }
  } else {
    chosen = orderSessions(open, normalizeSort(getConfig()?.homeassistant?.sessionsSort));
  }
  const windows = [];
  for (const session of chosen) {
    const w = getWindowById(session.windowId);
    if (!w) {
      log(`claude-place: окно сессии ${session.id} исчезло — пропущено`, 'warn');
      continue;
    }
    // Свёрнутое окно зоны не занимает. placeWindow() его и так пропустит, но
    // прямоугольник ему уже будет отдан — из четырёх сессий, где одна
    // свёрнута, три видимых раскладывались бы по четырём зонам, оставляя
    // дыру. Так же поступает macos-windows-manager.
    // getBounds() бросает, если процесс окна умер между перечислением сессий и
    // этой строкой; такое окно всё равно расставить не выйдет.
    let bounds;
    try {
      bounds = w.getBounds();
    } catch (e) {
      log(`claude-place: границы окна сессии ${session.id} не прочитались — пропущено (${e.message})`, 'warn');
      continue;
    }
    if (isMinimized(bounds)) {
      log(`claude-place: окно сессии ${session.id} свёрнуто — пропущено`);
      continue;
    }
    // Номер стола едет рядом с окном: он уже прочитан вместе со слотом, и
    // спрашивать его у VirtualDesktop11.exe по окну — лишний запуск процесса
    // на каждое окно там, где ответ уже на руках.
    windows.push({ w, desktop: session.desktop ?? null });
  }
  return { windows, asked: ids.length || open.length };
}

/**
 * Номер текущего рабочего стола, 1-based, либо null.
 *
 * Первым делом — по слоту активной сессии: там ответ уже есть и стоит ноль.
 * Активное окно не сессия (пикер, браузер, что угодно) — один запуск
 * VirtualDesktop11.exe; это единственное место раскладки, где он вообще
 * зовётся. Молчит и он — null, и группировка возьмёт стол первого окна.
 */
async function resolveCurrentDesktop(items, activeId, log) {
  const mine = items.find(it => it.w.id === activeId);
  if (mine?.desktop != null) return mine.desktop;
  if (!activeId) return null;
  try {
    const num = await virtualDesktop.GetWindowDesktopNumber(activeId);
    if (num !== undefined && num !== null) return Number(num) + 1;
  } catch (e) {
    log(`claude-place: не удалось узнать текущий стол — ${e.message}`, 'warn');
  }
  return null;
}

/**
 * Разложить окна сессий Claude плиткой или каскадом.
 *
 * Двигает `placeWindow()`, а не голый `setBounds()`: он уже умеет пропуск
 * свёрнутых окон, пропуск «уже стоит там», поправку масштаба при переезде
 * между экранами с разным DPI, повтор при промахе и строку журнала в
 * привычном формате `from → to`. Второй раз поправлять масштаб здесь нельзя.
 *
 * `isBulk: true` глушит bringToTop() внутри: окна поднимаются отдельным
 * проходом после расстановки — в порядке списка, так что последнее
 * оказывается сверху. Каскаду этот порядок нужен по смыслу, плитке он
 * безразличен (перекрытий нет), но поднимать её всё равно надо: раскладка
 * зовётся, чтобы увидеть сессии, а стоят они за чужими окнами.
 */
async function arrangeClaudeWindows({ mode, ids = [], log = () => {} }) {
  const mark = startTiming(`place ${mode}`);
  const zones = resolveZones(log, mode);
  mark('zones');
  // Плитка с уже разрешёнными зонами не читает рабочую область вовсе —
  // tileByZones() кладёт окна прямо в зоны. Звать layoutWorkArea() здесь всё
  // равно означало бы рисковать ложными строками warn про «главный монитор»
  // и «рабочая область вырождена», хотя ни один из этих исходов ни на что не
  // повлияет — раскладка пройдёт по зонам. Поэтому для этой комбинации
  // функция не зовётся вовсе, а не «зовётся, но её warn приглушаются».
  const work = (mode === 'tile' && zones.length) ? null : layoutWorkArea(zones, log);
  if (!work && (mode === 'cascade' || !zones.length)) {
    return { ok: false, reason: 'не найден монитор для раскладки' };
  }
  const { error, windows, asked } = pickWindows(ids, log, mark);
  if (error) return { ok: false, reason: error };
  if (!windows.length) {
    // Про ненайденные id уже есть строка warn в pickWindows(); здесь — точный
    // диагноз для отказа: если ids был задан, сессии-то есть, просто не эти.
    return {
      ok: false,
      reason: ids.length ? 'ни одна из запрошенных сессий claude здесь не открыта' : 'открытых сессий claude нет',
    };
  }

  // Переднее окно снимается до того, как что-либо сдвинулось: после подъёма
  // всей раскладки узнать, на что человек смотрел, уже негде.
  const activeBefore = getActiveWindowId();

  // Каждый стол раскладывается сам по себе: своя сетка зон с нуля, свой проход
  // подъёма. Иначе окна чужого стола съедали зоны у окон текущего — на обоих
  // столах оставались дыры, — а подъём чужого окна уносил человека на его стол.
  const current = await resolveCurrentDesktop(windows, activeBefore, log);
  const groups = groupByDesktop(windows, current);
  mark('desktops');
  let placed = 0;
  // Без изменений — окно дошло до placeWindow(), но bounds не поменялись:
  // слишком узкое, свёрнутое или уже стоящее ровно на месте. Различать
  // «свёрнуто» и «уже на месте» нельзя — placeWindow() отдаёт для обеих
  // веток одинаковый skipped. Упавшие (бросили) сюда не попадают: они не
  // «без изменений», а настоящий отказ, и про них уже есть строка error.
  let unchanged = 0;
  for (const group of groups) {
    const rects = arrange({ mode, zones, work, n: group.items.length });
    for (let i = 0; i < group.items.length; i += 1) {
      const pos = rects[i];
      if (!pos) {
        // Тихий break прятал бы это как «разложено N из M» без единой строки
        // warn — arrange() вернула меньше прямоугольников, чем окон, и это
        // само по себе повод для диагноза, а не для молчания.
        log(`claude-place: раскладка дала ${rects.length} прямоугольник(ов) на ${group.items.length} окон — остаток не расставлен`, 'warn');
        break;
      }
      // Одно упавшее окно не обрывает остальные — та же сетка, что в
      // placeWindowsByConfig(): процесс окна мог умереть между перечислением и
      // расстановкой.
      let result;
      try {
        result = await placeWindow({ w: group.items[i].w, rule: { pos }, isBulk: true });
      } catch (e) {
        log(`claude-place: ${group.items[i].w.id} — ${e.message}`, 'error');
        continue;
      }
      if (result && result.changes?.some(c => c.name === 'bounds')) placed += 1;
      else unchanged += 1;
    }
  }
  mark('place');
  // Поднимается только текущий стол. `bringToTop()` окна с чужого стола уводит
  // туда всю оболочку, и раскладка двух столов превращалась в чехарду
  // переключений; чужие окна уже стоят по своим зонам и поднимутся сами, когда
  // человек к ним переключится.
  const front = groups.find(g => g.isCurrent) ?? groups[0] ?? { items: [] };
  for (const { w } of front.items) {
    try {
      w.bringToTop();
    } catch (e) {
      log(`claude-place: ${w.id} не поднялось — ${e.message}`, 'warn');
    }
  }
  // Подъём — ещё не фокус: `bringToTop()` кладёт окно поверх остальных, но
  // ввод остаётся там, где был, и раскладка выходит немой. Кого фокусировать,
  // решает pickFocusTarget(); отказ не рушит раскладку — окна уже стоят и
  // подняты, а фокус мог не дойти до окна, свёрнутого или ушедшего на другой
  // стол между подъёмом и этой строкой.
  mark('raise');
  const focusId = pickFocusTarget(front.items.map(it => it.w.id), activeBefore);
  if (focusId !== null && !focusWindowById(focusId)) {
    log(`claude-place: фокус не дошёл до окна ${focusId}`, 'warn');
  }
  mark('focus');
  // Ноль без изменений — обычный случай, хвост не нужен: «разложено 2 из 3»
  // короче и не менее честно, чем «разложено 2, без изменений 0 из 3».
  const unchangedTail = unchanged ? `, без изменений ${unchanged}` : '';
  // Разбивка по столам появляется только когда их больше одного: на обычной
  // раскладке она была бы шумом, а на разбросанной отвечает на вопрос «почему
  // поднялись не все» — поднимается лишь текущий стол.
  const desktopsTail = groups.length > 1
    ? ` (столы: ${groups.map(g => `${g.desktop ?? '?'} — ${g.items.length}`).join(', ')})`
    : '';
  log(`claude-place ${mode}: разложено ${placed}${unchangedTail} из ${asked}${desktopsTail}`);
  return { ok: true, placed };
}

export { arrangeClaudeWindows };
