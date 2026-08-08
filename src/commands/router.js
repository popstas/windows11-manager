/**
 * Единственный список команд в проекте.
 *
 * До него `switch` по командам был продублирован в http-server.js и
 * ws-client.js; при пяти командах списки уже разъезжались, а после переезда из
 * windows-mqtt их стало двадцать. MQTT и HTTP — транспорты поверх этой карты,
 * своих списков они не держат.
 *
 * dispatch не бросает никогда: полезная нагрузка приходит снаружи (брокер,
 * панель, чужой пикер), и упавший обработчик не должен ронять транспорт вместе
 * с подпиской на все остальные топики.
 */
function createRouter(handlers = {}) {
  const map = new Map(Object.entries(handlers));

  async function dispatch(command, payload) {
    const handler = map.get(command);
    if (!handler) return { ok: false, error: `unknown command: ${command}` };
    try {
      return { ok: true, result: await handler(payload) };
    } catch (err) {
      return { ok: false, error: err?.message ?? String(err) };
    }
  }

  return {
    dispatch,
    has: (command) => map.has(command),
    commands: () => [...map.keys()],
  };
}

export { createRouter };
