/**
 * Связь с брокером — строкой для трея.
 *
 * Трей знал про службу только «процесс жив»: `Service: running` держался и
 * тогда, когда клиент раз в пять секунд получал от брокера «not authorized».
 * Служба сообщает о переходах связи служебной строкой в stdout — трей читает
 * её поток всё равно (`pump_output` в `children.rs`) и по ней правит пункт
 * меню, подсказку и метку на значке.
 *
 * Формат: `@@w11m-link {"state":"connected"}`, у обрыва ещё `reason`.
 * Состояния: `off` (брокер не настроен), `connecting`, `connected`,
 * `disconnected`. Разбирает строку `mqtt_link::parse_line` в трее — формат
 * меняется только вместе с ним.
 */

const LINK_MARKER = '@@w11m-link ';

/** Причину режем: она ложится в пункт меню, а не в лог. */
const REASON_MAX = 60;

function linkLine(state, reason) {
  return LINK_MARKER + JSON.stringify(reason ? { state, reason } : { state });
}

/**
 * Ошибка mqtt.js → короткая причина для меню. Отказ брокера приходит с кодом
 * CONNACK (`err.code` 4 или 5), сетевые — с кодом сокета.
 */
function shortReason(err) {
  const code = err?.code;
  const message = String(err?.message ?? err ?? '');
  if (code === 5 || /not authori[sz]ed/i.test(message)) return 'not authorized';
  if (code === 4 || /bad user ?name or password/i.test(message)) return 'bad user name or password';
  if (code === 'ECONNREFUSED') return 'connection refused';
  if (code === 'ETIMEDOUT') return 'timeout';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'host not found';
  if (message.length <= REASON_MAX) return message || 'unknown error';
  return `${message.slice(0, REASON_MAX - 1).trimEnd()}…`;
}

/**
 * Следит за событиями клиента и пишет строку только на смену состояния.
 *
 * Отказ брокера приходит парой `error` → `close`, и `close` своей причины не
 * знает — берёт последнюю из `error`. `reconnect` намеренно не слушается:
 * при неверном пароле он приходит каждые пять секунд, и значок мигал бы
 * между «подключаемся» и «обрыв».
 */
function createLinkReporter(write) {
  let shown = null;
  let lastReason = null;
  const emit = (state, reason) => {
    const line = linkLine(state, reason);
    if (line === shown) return;
    shown = line;
    write(line);
  };
  return {
    off: () => emit('off'),
    connecting: () => emit('connecting'),
    connected: () => {
      lastReason = null;
      emit('connected');
    },
    error: (err) => {
      lastReason = shortReason(err);
      emit('disconnected', lastReason);
    },
    closed: () => emit('disconnected', lastReason ?? 'connection lost'),
  };
}

export { LINK_MARKER, linkLine, shortReason, createLinkReporter };
