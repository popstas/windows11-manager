/**
 * Статистика окон в Home Assistant. Переехала из
 * windows-mqtt/src/modules/windows.js (publishStats).
 *
 * Топик берётся из `publishStatsTopic` и по умолчанию лежит под базой окон, но
 * на этой машине он задан отдельно (`state/pc/windows`) и к базе отношения не
 * имеет: подставлять базу молча нельзя.
 */

// Раз в минуту: getStats() зовёт getWindows(), а это OpenProcess и путь к exe на
// каждое окно системы (~21-31 мс, см. AGENTS.md, «claude-wt polling budget»).
// Для графика в Home Assistant минуты хватает с запасом.
const STATS_INTERVAL_MS = 60000;

/**
 * Дописать нули пропавшим приложениям.
 *
 * Без этого график в Home Assistant держит последнее ненулевое значение вечно:
 * закрытому приложению никто больше не публикует ни строки, и на графике оно
 * навсегда остаётся открытым. Нуль пишется ровно один раз — приложение, у
 * которого в прошлом замере уже стоял нуль, пропускается, иначе мёртвые имена
 * публиковались бы до перезапуска службы.
 *
 * Прошлый замер приходит одними счётчиками, а не целым `stats`: в `byApp[*].wins`
 * лежат объекты окон нативного модуля, и держать их лишнюю минуту ради сравнения
 * чисел незачем.
 */
function zeroMissingApps(stats, lastCounts) {
  const byApp = { ...(stats.byApp ?? {}) };
  for (const app in lastCounts ?? {}) {
    if (!lastCounts[app]) continue;
    if (!byApp[app]) byApp[app] = { count: 0, wins: [] };
  }
  return { ...stats, byApp };
}

/** Замер без окон: только имя и число. Его и помним до следующего раза. */
function appCounts(stats) {
  const counts = {};
  for (const name in stats.byApp ?? {}) counts[name] = stats.byApp[name].count;
  return counts;
}

/** Сообщения одного замера. Чистая функция: топики проверяются без брокера. */
function statsMessages(stats, topicBase) {
  const messages = [{ topic: `${topicBase}/total`, payload: `${stats.total}` }];
  for (const name in stats.byApp ?? {}) {
    messages.push({ topic: `${topicBase}/apps/${name}`, payload: `${stats.byApp[name].count}` });
  }
  if (stats.active) {
    // `?? ''`, а не как есть: у окна без пути или без заголовка поле приезжает
    // undefined, и шаблонная строка публиковала бы в Home Assistant слово
    // "undefined" — оно оседает в истории сенсора и выглядит как имя приложения.
    messages.push({ topic: `${topicBase}/active/app`, payload: `${stats.active.app ?? ''}` });
    messages.push({ topic: `${topicBase}/active/title`, payload: `${stats.active.title ?? ''}` });
  }
  return messages;
}

/**
 * Публикатор статистики. `start()` повторно ничего не заводит: его зовут на
 * каждое подключение к брокеру, а переподключений за жизнь службы много.
 */
function createStatsPublisher({ winMan, publish, config, log }) {
  const topicBase = config.publishStatsTopic || `${config.base}/stats`;
  let lastCounts = {};
  let timerId = null;

  function publishOnce() {
    // Перехват — не осторожность вообще, а необходимость: getStats() ходит в
    // нативный модуль, а исключение из обработчика setInterval роняет весь
    // процесс службы. Молчащий график лучше молчащего MQTT.
    let stats;
    try {
      stats = winMan.getStats();
    } catch (e) {
      log(`stats: не удалось собрать статистику окон: ${e.message}`, 'error');
      return;
    }
    const withZeros = zeroMissingApps(stats, lastCounts);
    lastCounts = appCounts(withZeros);
    for (const m of statsMessages(withZeros, topicBase)) publish(m.topic, m.payload);
  }

  return {
    start() {
      if (!config.publishStats || timerId !== null) return;
      publishOnce();
      timerId = setInterval(publishOnce, STATS_INTERVAL_MS);
    },
    stop() {
      if (timerId === null) return;
      clearInterval(timerId);
      timerId = null;
    },
    publishOnce,
    topicBase,
  };
}

export { createStatsPublisher, zeroMissingApps, appCounts, statsMessages, STATS_INTERVAL_MS };
