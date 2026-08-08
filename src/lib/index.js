export * from '../placement.js';
export * from '../windows.js';
export * from '../monitors.js';
export * from '../fancyzones.js';
export * from '../virtual-desktop.js';
export * from '../store.js';
export * from '../stats.js';
export * from '../wallpapers.js';
export * from '../config.js';
export * from '../claude-wt/index.js';
export * from '../claude-wt/restore.js';
export * from '../claude-wt/view.js';
export * from '../claude-wt/project.js';
export { invalidateSessionIndex } from '../claude-wt/sessions.js';
// startHttpServer наружу не отдаётся намеренно. Поднятый внутри процесса демона
// (так его звал windows-mqtt по ключу claudeWtHttpPort), он вешал событийный
// цикл через две-три минуты после старта. Отдельной командой `--port` сервер
// работает как работал — там он в своём процессе и демону ничем не мешает.
