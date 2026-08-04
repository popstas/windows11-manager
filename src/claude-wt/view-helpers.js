/** Pure helpers for the session picker view. No external I/O. */
import { lastActivityAt, seenSinceUpdate, sessionDescription } from './progress-helpers.js';

/**
 * Monitor number for a window, taken from its centre point.
 *
 * The top-left corner lands on the neighbouring monitor for any window that
 * straddles a seam, and outside every monitor for one left at coordinates from
 * a display that is gone. The centre is right in both cases.
 *
 * `mons` is the getMons() array: index 0 is a placeholder, so the index of a
 * monitor is the number used in placement rules.
 */
function monitorNumberForBounds(mons, bounds) {
  if (!bounds) return null;
  const x = bounds.x + Math.floor(bounds.width / 2);
  const y = bounds.y + Math.floor(bounds.height / 2);
  for (let i = 1; i < (mons?.length ?? 0); i++) {
    const b = mons[i]?.bounds;
    if (!b) continue;
    if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) return i;
  }
  return null;
}

/**
 * Кто на самом деле работает в этой сессии: она сама или её фоновый агент.
 *
 * `claude agents` уводит работу в форк под демоном: интерактивный процесс
 * уходит, окно остаётся с прежним заголовком, и хуки с этого момента пишет
 * форк — под своим id. Строка родителя без этого стоит с той сводкой, на
 * которой он ушёл в фон, а работающий агент не виден нигде.
 *
 * Берётся тот, чья запись свежее. Родитель может ожить обратно (человек
 * вернулся в окно), и тогда снова говорит он.
 */
function activeAgent(id, progress, agents) {
  let best = { id, agent: progress[id] ?? null, background: false };
  for (const child of agents[id] ?? []) {
    const childAgent = progress[child.id] ?? null;
    if (!childAgent) continue;
    if ((childAgent.updated ?? 0) <= (best.agent?.updated ?? 0)) continue;
    best = { id: child.id, agent: childAgent, background: true };
  }
  return best;
}

function buildSessionList({ slots, openMap, mons, progress = {}, meta = {}, agents = {} }) {
  return Object.entries(slots ?? {}).map(([id, slot]) => {
    const bounds = slot.bounds ?? null;
    const monitor = monitorNumberForBounds(mons, bounds);
    const active = activeAgent(id, progress, agents);
    const agent = active.agent;
    const sessionMeta = meta[id] ?? null;
    return {
      id,
      title: slot.titles?.[0] ?? '',
      cwd: slot.cwd ?? '',
      bounds,
      desktop: slot.desktop ?? null,
      monitor,
      monitorBounds: monitor === null ? null : (mons[monitor]?.bounds ?? null),
      open: openMap.has(id),
      windowId: openMap.get(id) ?? null,
      // Что делает агент внутри окна: active | question | review | idle, либо
      // null, когда хук состояний не установлен или ещё не сработал.
      agentState: agent?.state ?? null,
      // Событие хука, из которого состояние получилось (tool-start, attention,
      // stop…). Состояние — это вывод, событие — исходник; в подсказке видно,
      // почему кружок такой.
      agentEvent: agent?.event ?? '',
      // Текст уведомления. Осмыслен только у attention: «Claude needs your
      // permission» против «Claude is waiting for your input» — единственное,
      // что отличает жёлтый кружок от серого.
      agentMessage: agent?.message ?? '',
      // Первая строка последнего ответа агента: «Закоммитил — ea527f0, рабочее
      // дерево чистое». Отвечает на вопрос «чем эта сессия закончила», на
      // который ни состояние, ни заголовок окна не отвечают.
      agentSummary: agent?.summary ?? '',
      // То же самое, но не стёртое у работающей сессии: «на чём остановилась в
      // прошлый раз» — вопрос отдельный от «что говорит сейчас».
      agentLastSummary: agent?.lastSummary ?? '',
      // Одна строка «что сессия говорит о себе»: сводка, а у работающей —
      // последняя известная. Собрана здесь, чтобы пикер, Home Assistant и плата
      // показывали одно и то же; каждый, кто склеивал это у себя, рано или
      // поздно расходился с соседом.
      agentDescription: sessionDescription(agent),
      // Последний запрос человека. Пикер кладёт его строкой над сводкой ответа:
      // «что спросили» и «чем ответили» — разные вещи, и глазом их проще
      // разделить, чем читать подряд в одной подсказке.
      agentPrompt: agent?.prompt ?? '',
      // Целые доллары и целые проценты контекста. Ноль — данных нет: перехват
      // статуслайна стоит не у всех сессий, и отличать «не знаем» от «ничего не
      // потратила» приходится по нулю, других признаков тут нет.
      agentCostUsd: agent?.costUsd ?? 0,
      agentContextPct: agent?.contextPct ?? 0,
      // Ветка и PR. Имя `pr_url` держится одинаковым во всей цепочке — от
      // файла хука до пункта меню, — чтобы поле искалось по одному слову.
      branch: agent?.branch ?? '',
      pr_url: agent?.pr_url ?? '',
      // Когда сессия стартовала (SessionStart → meta.json). Ноль — хук метаданных
      // не писал: сортировка oldest/newest кладёт такие строки в конец.
      agentStarted: sessionMeta?.started ?? 0,
      // Когда начался текущий ход (последний промпт). Отдельно от agentStarted:
      // тот про всю сессию — «46m», а спрашивают обычно про другое, «сколько уже
      // крутится эта команда». Ноль — сессия старше правки в хуке.
      agentTurnAt: agent?.turnAt ?? 0,
      // Работает не сама сессия, а её фоновый агент (`claude agents`): все
      // поля agent* выше — его. Строка при этом остаётся строкой родителя,
      // потому что окно и слот — родительские, а у агента их нет вовсе.
      agentBackground: active.background,
      // Id того, чьи это поля. Совпадает с id строки, пока работает сама
      // сессия; у фонового агента свой — по нему и искать его транскрипт.
      agentSessionId: active.id,
      // Epoch-секунды. Пикер показывает возраст относительно now, поэтому
      // отдаём метку времени, а не отформатированную строку: форматирование
      // на секунду устаревает быстрее, чем долетает.
      lastActivity: lastActivityAt(slot, agent),
      // Когда окно этой сессии последний раз выходило на передний план (epoch
      // sec). Нужен project hotkeys'у, чтобы выбрать «последнюю» среди нескольких
      // открытых сессий одного cwd; пикер сам по себе поле не показывает.
      focusedAt: slot.focusedAt ?? 0,
      // Окно выходило на передний план уже после того, как агент записал своё
      // состояние, — то есть человек это состояние видел. Сравнение считается
      // здесь: обе метки известны только тут, а пикеру нужен готовый ответ.
      agentSeen: seenSinceUpdate(slot, agent),
    };
  });
}

export { monitorNumberForBounds, activeAgent, buildSessionList };
