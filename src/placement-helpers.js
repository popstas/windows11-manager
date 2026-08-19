/** Pure helper functions for placement logic. No external I/O or config. */

function resolveMonitorRelativePos({ oper, newPos, monBounds, monNum, panelWidth, panelHeight }) {
  let third = (monBounds.width - panelWidth) / 3;
  if (monNum === 2) third -= panelWidth;
  switch (oper) {
    case 'top':
      return { field: 'y', value: monBounds.y };
    case 'right': {
      let x = monBounds.x + monBounds.width - newPos.width;
      if (monNum === 1) x -= panelWidth;
      if (monNum === 3) x += panelWidth;
      return { field: 'x', value: x };
    }
    case 'bottom': {
      let y = monBounds.y + monBounds.height - newPos.height;
      if (monNum === 2) y -= panelHeight;
      return { field: 'y', value: y };
    }
    case 'left': {
      let x = monBounds.x;
      if (monNum === 3) x += panelWidth;
      return { field: 'x', value: x };
    }
    case 'x-2/3': {
      let x = monBounds.x + third * 1;
      if (monNum === 3) x += panelWidth;
      return { field: 'x', value: parseInt(x) };
    }
    case 'x-3/3': {
      let x = monBounds.x + third * 2;
      if (monNum === 3) x += panelWidth;
      return { field: 'x', value: parseInt(x) };
    }
    case 'width':
      return { field: 'width', value: monBounds.width };
    case 'halfWidth':
      return { field: 'width', value: parseInt((monBounds.width - panelWidth) / 2) };
    case 'thirdWidth':
      return { field: 'width', value: parseInt((monBounds.width - panelWidth) / 3) };
    case 'height':
      return { field: 'height', value: monBounds.height };
    default:
      return undefined;
  }
}

function parsePosFromRule({ rule, mons, panelWidth, panelHeight }) {
  const pos = rule;
  if (!pos) return false;
  if (pos.fancyZones) return { fancyZones: pos.fancyZones };
  const newPos = {};
  for (const name of ['width', 'height', 'x', 'y']) {
    if (['x', 'y'].includes(name) && pos[name] === undefined) return false;
    newPos[name] = pos[name];
    const val = newPos[name];
    if (parseInt(val)) continue;
    if (!val) continue;
    const res = val.match(/^mon(\d+)\.(.*)$/);
    if (!res) continue;
    const monNum = Number(res[1]);
    const oper = res[2];
    const mon = mons[monNum];
    if (!mon) return false;
    const monBounds = mon.bounds;
    const resolved = resolveMonitorRelativePos({
      oper, newPos, monBounds, monNum, panelWidth, panelHeight,
    });
    if (resolved) newPos[resolved.field] = resolved.value;
  }
  return newPos;
}

/**
 * Что расстановщику разрешено делать с рабочими столами.
 *
 * Две галочки из окна настроек доезжают до node переменными окружения, а не
 * флагами: автоrasстановщик поднимается как `node examples/autoplace-server.js`,
 * аргументов не разбирает вовсе, и флаг пришлось бы протаскивать через
 * placeWindowOnOpen() до самого placeWindow(). Значение читается на старте
 * процесса, поэтому смена галочки перезапускает автоrasстановщик.
 *
 * `move` — переносить ли окно на стол из правила, `follow` — переключать ли
 * вслед за ним текущий стол. Стороны независимы: с move=false переносов нет
 * вовсе, и follow ни на что не влияет.
 */
function desktopPolicy(env = {}) {
  return {
    move: !isFlagOn(env.W11M_NO_MOVE_DESKTOP),
    follow: !isFlagOn(env.W11M_NO_FOLLOW_DESKTOP),
  };
}

/**
 * Снятая галочка приходит не только отсутствием переменной: Rust с тем же
 * успехом пишет "0" или пустую строку, а голая проверка на истинность строки
 * прочитала бы "0" как запрет — то есть выключила бы перенос ровно тогда,
 * когда человек его включил.
 */
function isFlagOn(value) {
  if (value === undefined || value === null) return false;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export { resolveMonitorRelativePos, parsePosFromRule, desktopPolicy };
