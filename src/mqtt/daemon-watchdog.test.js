import { describe, it, expect, vi } from 'vitest';
import {
  startDaemonWatchdog, daemonStatusFromFile, createRemedy, SILENCE_MS, GRACE_MS, PID_TRUST_MS,
} from './daemon-watchdog.js';
import { claudeWtHealth } from '../claude-wt/daemon-helpers.js';
import { CHECK_INTERVAL_MS, REMEDY_COOLDOWN_MS } from '../claude-wt/watchdog.js';

const HOST = 'pc-home';

function fileOf({ pid = 4242, generatedMs, host = HOST } = {}) {
  return JSON.stringify({ host, pid, generated: Math.floor(generatedMs / 1000), windows: {} });
}

function setup({ cfg = {}, file = null, kill = vi.fn(), health = claudeWtHealth } = {}) {
  const logs = [];
  const notes = [];
  let now = 10_000_000;
  let content = file;
  const winMan = {
    getClaudeWtConfig: () => ({ enabled: true, windowsFile: 'V:/windows.json', ...cfg }),
    claudeWtHealth: health,
  };
  const watchdog = startDaemonWatchdog({
    winMan,
    log: (message, level = 'info') => logs.push(`${level}: ${message}`),
    notify: (message) => notes.push(message),
    kill,
    readFile: () => content,
    now: () => now,
    hostname: HOST,
  });
  return {
    watchdog,
    logs,
    notes,
    kill,
    nowMs: () => now,
    advance: (ms) => { now += ms; vi.advanceTimersByTime(ms); },
    setFile: (value) => { content = value; },
  };
}

describe('daemonStatusFromFile', () => {
  it('отметка «сгенерирован» приезжает в миллисекундах', () => {
    const s = daemonStatusFromFile({ host: HOST, pid: 7, generated: 1000 },
      { hostname: HOST, startedAt: 5, nowMs: 1_000_000 });
    expect(s).toMatchObject({ running: true, lastTickAt: 1_000_000, pid: 7, foreign: false });
  });

  it('файла нет — отметки нет, а демон всё равно считается должным работать', () => {
    // Иначе health() сразу выдал бы «not running», и сторож снимал бы демона,
    // который ещё не успел записать первый файл.
    const s = daemonStatusFromFile(null, { hostname: HOST, startedAt: 5, nowMs: 1_000_000 });
    expect(s).toMatchObject({ running: true, lastTickAt: 0, pid: 0, startedAt: 5 });
  });

  it('файл чужой машины считается отсутствующим и pid из него не берётся', () => {
    const s = daemonStatusFromFile({ host: 'other-pc', pid: 999, generated: 1000 },
      { hostname: HOST, startedAt: 5, nowMs: 1_000_000 });
    expect(s).toMatchObject({ foreign: true, pid: 0, lastTickAt: 0 });
  });

  it('счётчиков падений тиков в файле нет, и сторож их не выдумывает', () => {
    const s = daemonStatusFromFile({ host: HOST, pid: 7, generated: 1000 },
      { hostname: HOST, startedAt: 5, nowMs: 1_000_000 });
    expect(s.tickFailures).toBe(0);
    expect(s.lastTickError).toBe('');
  });

  it('pid из пролежавшего файла не берётся: номер уже мог достаться чужому процессу', () => {
    // Демона остановили из трея, файл остался лежать с мёртвым pid навсегда.
    const s = daemonStatusFromFile({ host: HOST, pid: 999, generated: 1000 },
      { hostname: HOST, startedAt: 5, nowMs: 1_000_000 + PID_TRUST_MS + 1 });
    expect(s.pid).toBe(0);
    expect(s.pidStale).toBe(true);
    // Возраст отметки при этом остаётся: по нему и ставится диагноз «молчит».
    expect(s.lastTickAt).toBe(1_000_000);
  });

  it('pid из файла на границе срока годности ещё берётся', () => {
    const s = daemonStatusFromFile({ host: HOST, pid: 999, generated: 1000 },
      { hostname: HOST, startedAt: 5, nowMs: 1_000_000 + PID_TRUST_MS });
    expect(s).toMatchObject({ pid: 999, pidStale: false });
  });

  it('срок годности pid переживает первое лечение', () => {
    // Иначе сторож не снял бы даже зависшего демона: лечение зовут не раньше,
    // чем через SILENCE_MS, а проверки идут раз в тридцать секунд.
    expect(PID_TRUST_MS).toBeGreaterThan(SILENCE_MS + CHECK_INTERVAL_MS);
  });
});

describe('createRemedy', () => {
  it('снимает процесс по pid и говорит, что поднимет его Tauri', () => {
    const logs = [];
    const notes = [];
    const kill = vi.fn();
    const remedy = createRemedy({ kill, log: (m) => logs.push(m), notify: (m) => notes.push(m) });
    expect(remedy({ pid: 4242 })).toBe(true);
    expect(kill).toHaveBeenCalledWith(4242);
    expect(logs.join(' ')).toContain('4242');
    expect(notes.join(' ')).toContain('Tauri');
  });

  it('без pid зовёт человека, а не ищет процесс по имени', () => {
    const logs = [];
    const notes = [];
    const kill = vi.fn();
    const remedy = createRemedy({ kill, log: (m, l) => logs.push([m, l]), notify: (m) => notes.push(m) });
    expect(remedy({ pid: 0 })).toBe(false);
    expect(kill).not.toHaveBeenCalled();
    expect(logs[0][1]).toBe('error');
    expect(notes[0]).toContain('ручной перезапуск');
  });

  it('свой собственный pid не снимается никогда', () => {
    const kill = vi.fn();
    const remedy = createRemedy({ kill, log: () => {}, notify: () => {} });
    expect(remedy({ pid: process.pid })).toBe(false);
    expect(kill).not.toHaveBeenCalled();
  });

  it('несостоявшееся снятие видно и в логе, и человеку', () => {
    const logs = [];
    const notes = [];
    const kill = vi.fn(() => { throw new Error('ESRCH'); });
    const remedy = createRemedy({ kill, log: (m, l) => logs.push([m, l]), notify: (m) => notes.push(m) });
    expect(remedy({ pid: 11 })).toBe(false);
    expect(logs[0][0]).toContain('ESRCH');
    expect(logs[0][1]).toBe('error');
    expect(notes[0]).toContain('ESRCH');
  });

  it('устаревший pid говорит человеку именно про пролежавший файл', () => {
    const logs = [];
    const kill = vi.fn();
    const remedy = createRemedy({ kill, log: (m, l) => logs.push([m, l]), notify: () => {} });
    expect(remedy({ pid: 0, pidStale: true })).toBe(false);
    expect(kill).not.toHaveBeenCalled();
    expect(logs[0][0]).toContain('файл окон давно не переписывали');
  });

  it('тот же pid не снимается второй раз, пока файл не переписали', () => {
    // Неудача снятия — это «такого процесса нет», а не приглашение повторять
    // каждые пять минут: номер к тому времени достаётся кому-то другому.
    const notes = [];
    const kill = vi.fn(() => { throw new Error('ESRCH'); });
    const remedy = createRemedy({ kill, log: () => {}, notify: (m) => notes.push(m) });
    const status = { pid: 11, lastTickAt: 1000 };
    expect(remedy(status)).toBe(false);
    expect(remedy(status)).toBe(false);
    expect(remedy(status)).toBe(false);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(notes[1]).toContain('не помогло');
  });

  it('после новой записи файла тот же pid снимается снова', () => {
    // Демон поднялся, получил тот же номер и снова замолчал — это уже другая
    // поломка, и лечить её можно.
    const kill = vi.fn();
    const remedy = createRemedy({ kill, log: () => {}, notify: () => {} });
    expect(remedy({ pid: 11, lastTickAt: 1000 })).toBe(true);
    expect(remedy({ pid: 11, lastTickAt: 2000 })).toBe(true);
    expect(kill).toHaveBeenCalledTimes(2);
  });
});

describe('startDaemonWatchdog', () => {
  it('без claudeWtHealth сторож не заводится вовсе', () => {
    // Иначе check() падал бы раз в тридцать секунд в глушащий обработчик
    // таймера, и с виду сторож работал бы, а на деле не смотрел бы ни за чем.
    const logs = [];
    const w = startDaemonWatchdog({
      winMan: { getClaudeWtConfig: () => ({ enabled: true, windowsFile: 'V:/w.json' }) },
      log: (m, l = 'info') => logs.push(`${l}: ${m}`),
    });
    expect(logs.some((l) => l.startsWith('error:') && l.includes('claudeWtHealth'))).toBe(true);
    expect(() => w.stop()).not.toThrow();
  });

  it('без windowsFile сторож не заводится и жалуется, но не в error', () => {
    // Конфигурация по умолчанию: enabled включён, windowsFile пуст. Error-строка
    // на каждом старте у нормальной настройки отучает читать error-строки.
    const logs = [];
    startDaemonWatchdog({
      winMan: { getClaudeWtConfig: () => ({ enabled: true, windowsFile: '' }), claudeWtHealth },
      log: (m, l = 'info') => logs.push(`${l}: ${m}`),
    });
    expect(logs.some((l) => l.startsWith('warn:') && l.includes('незамеченным'))).toBe(true);
    expect(logs.some((l) => l.startsWith('error:'))).toBe(false);
  });

  it('при выключенном claudeWt сторож молчит', () => {
    const logs = [];
    startDaemonWatchdog({
      winMan: { getClaudeWtConfig: () => ({ enabled: false, windowsFile: 'V:/w.json' }), claudeWtHealth },
      log: (m, l = 'info') => logs.push(`${l}: ${m}`),
    });
    expect(logs).toEqual([]);
  });

  it('свежий файл окон — ни строки, ни снятия', () => {
    vi.useFakeTimers();
    try {
      const s = setup({ file: fileOf({ generatedMs: 10_000_000 }) });
      s.setFile(fileOf({ generatedMs: 10_000_000 }));
      s.advance(CHECK_INTERVAL_MS);
      expect(s.logs).toEqual([]);
      expect(s.kill).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('замолчавший файл окон — процесс снимается по pid из него', () => {
    vi.useFakeTimers();
    try {
      const s = setup({ file: fileOf({ pid: 4242, generatedMs: 10_000_000 }) });
      s.advance(SILENCE_MS + CHECK_INTERVAL_MS);
      expect(s.kill).toHaveBeenCalledWith(4242);
      expect(s.notes.join(' ')).toContain('4242');
      s.watchdog.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('давно пролежавший файл не отдаёт pid в снятие ни разу и никогда', () => {
    // Демона остановили из трея (или claude_wt_enabled выключен в настройках
    // Tauri, а claudeWt.enabled в конфиге — нет): файл лежит с мёртвым pid,
    // MQTT работает дальше. Без срока годности сторож звал бы kill на этот
    // номер каждый кулдаун, а Windows рано или поздно выдаст его чужому
    // процессу — и сторож примется методично убивать постороннее.
    vi.useFakeTimers();
    try {
      const s = setup({ file: fileOf({ pid: 4242, generatedMs: 10_000_000 - 2 * 3600 * 1000 }) });
      s.advance(CHECK_INTERVAL_MS);
      expect(s.kill).not.toHaveBeenCalled();
      expect(s.notes.join(' ')).toContain('файл окон давно не переписывали');
      // И через сутки проверок — тоже ни одного снятия.
      s.advance(24 * 3600 * 1000);
      expect(s.kill).not.toHaveBeenCalled();
      // При этом молчание всё равно видно в логе на каждой проверке.
      expect(s.logs.filter((l) => l.includes('нездоров')).length).toBeGreaterThan(1);
      s.watchdog.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('снятие не повторяется по тому же pid, пока файл не переписан', () => {
    vi.useFakeTimers();
    try {
      const kill = vi.fn(() => { throw new Error('ESRCH'); });
      const s = setup({ file: fileOf({ pid: 4242, generatedMs: 10_000_000 }), kill });
      s.advance(SILENCE_MS + CHECK_INTERVAL_MS);
      expect(kill).toHaveBeenCalledTimes(1);
      // Дальше файл никто не переписывает: ни одного повторного снятия.
      s.advance(24 * 3600 * 1000);
      expect(kill).toHaveBeenCalledTimes(1);
      s.watchdog.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('пока файла нет, сторож ждёт отсрочку и только потом зовёт человека', () => {
    vi.useFakeTimers();
    try {
      const s = setup({ file: null });
      s.advance(GRACE_MS - CHECK_INTERVAL_MS);
      expect(s.notes).toEqual([]);
      s.advance(CHECK_INTERVAL_MS * 2);
      expect(s.notes.join(' ')).toContain('pid неизвестен');
      expect(s.kill).not.toHaveBeenCalled();
      s.watchdog.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() гасит проверки', () => {
    vi.useFakeTimers();
    try {
      const s = setup({ file: fileOf({ generatedMs: 10_000_000 }) });
      s.watchdog.stop();
      s.advance(SILENCE_MS * 10);
      expect(s.kill).not.toHaveBeenCalled();
      expect(s.logs).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('неустранимая поломка зовёт человека один раз, но пишется в лог каждый раз', () => {
    // Демон, остановленный из трея намеренно, молчит вечно: уведомление раз в
    // пять минут до конца времён отучает смотреть на уведомления вообще.
    vi.useFakeTimers();
    try {
      const kill = vi.fn(() => { throw new Error('ESRCH'); });
      const s = setup({ file: fileOf({ pid: 4242, generatedMs: 10_000_000 }), kill });
      s.advance(SILENCE_MS + CHECK_INTERVAL_MS);
      const afterFirst = s.logs.length;
      s.advance(60 * 60 * 1000);
      expect(s.notes).toHaveLength(1);
      expect(s.logs.length).toBeGreaterThan(afterFirst);
      s.watchdog.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('после выздоровления следующая поломка снова зовёт человека', () => {
    vi.useFakeTimers();
    try {
      const kill = vi.fn(() => { throw new Error('ESRCH'); });
      const s = setup({ file: fileOf({ pid: 4242, generatedMs: 10_000_000 }), kill });
      s.advance(SILENCE_MS + CHECK_INTERVAL_MS);
      expect(s.notes).toHaveLength(1);
      // Демон поднялся и снова пишет файл.
      s.setFile(fileOf({ pid: 4243, generatedMs: s.nowMs() }));
      s.advance(CHECK_INTERVAL_MS);
      // И снова замолчал — теперь надолго: второе лечение ждёт ещё и кулдауна.
      s.advance(SILENCE_MS + REMEDY_COOLDOWN_MS);
      expect(s.notes).toHaveLength(2);
      s.watchdog.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('чужой файл окон отмечается один раз, а не каждые тридцать секунд', () => {
    vi.useFakeTimers();
    try {
      const s = setup({ file: fileOf({ generatedMs: 10_000_000, host: 'other-pc' }) });
      s.advance(CHECK_INTERVAL_MS * 3);
      expect(s.logs.filter((l) => l.includes('чужая машина'))).toHaveLength(1);
      s.watchdog.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
