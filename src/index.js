import fs from 'node:fs';
import path from 'node:path';
import { program } from 'commander';
import * as winMan from './lib/index.js';
winMan.watchAppliedLayouts();

start();

async function start() {
  program.option('--first');

  program
    .command('place')
    .option('-v, --verbose', 'verbose placement logging')
    .action((options) => winMan.placeWindows({ verbose: options.verbose }));
  program
    .command('store')
    .action(() => {
      winMan.storeWindows();
      process.exit(0);
    });
  program
    .command('restore')
    .option('-v, --verbose', 'verbose logging')
    .action(async () => {
      await winMan.restoreWindows();
      process.exit(0);
    });

  program.command('clear').action(() => {
    winMan.clearWindows();
    process.exit(0);
  });

  program.command('reload').action(() => {
    winMan.reloadConfigs();
    process.exit(0);
  });

  program.command('wallpapers').action(async () => {
    await winMan.setWallpapers();
    process.exit(0);
  });

  program.command('open-default').action(() => {
    const config = winMan.getConfig();
    const stored = config?.store?.default;
    if (stored) {
      if (stored.apps) stored.windows = stored.apps.map(p => ({ path: p }));
      winMan.openStore(stored);
    }
    process.exit(0);
  });

  program
    .command('place-window')
    .option('--window <window>', 'window title or "current"', 'current')
    .option('--monitor <monitor>', 'monitor number', '1')
    .option('--position <position>', 'zone position number', '1')
    .action(async (options) => {
      const rule = {
        window: options.window,
        fancyZones: { monitor: options.monitor, position: options.position },
      };
      await winMan.placeWindowByConfig(rule);
    });

  program
    .command('http-server')
    .option('--port <port>', 'HTTP server port', '9722')
    .action(async (options) => {
      const { startHttpServer } = await import('./http-server.js');
      startHttpServer(Number(options.port));
    });

  program
    .command('mqtt')
    .description('MQTT: подписка на команды окон и экспорт сессий в Home Assistant')
    .action(async () => {
      const { startMqttService } = await import('./mqtt/service.js');
      const log = (message, level = 'info') => {
        if (level === 'error') console.error(`[mqtt] ${message}`);
        else console.log(`[mqtt] ${message}`);
      };
      // Общая сетка под всеми долгоживущими обработчиками этого процесса.
      // Здесь живут разом клиент MQTT, экспорт в Home Assistant, статистика
      // окон, автоматическая расстановка и сторож демона claude-wt, а node 22
      // на необработанном отклонении выходит целиком и молча. Tauri при этом
      // поднимает заново только демона claude-wt, но не эту службу, так что
      // одно упавшее обещание в расстановщике уносило бы вообще всё — и
      // человек узнавал бы об этом по остывшей панели.
      process.on('unhandledRejection', (reason) => {
        const detail = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
        log(`необработанное отклонение обещания, служба продолжает работу: ${detail}`, 'error');
      });
      // uncaughtException сюда намеренно не добавлен: синхронные исключения
      // ловятся на месте (обработчики таймеров), а глушить их скопом — значит
      // оставлять процесс жить в состоянии, про которое ничего не известно.

      const service = startMqttService({ winMan, config: winMan.getConfig(), log });
      // stop() — единственный, кто публикует availability: offline. Без этих
      // подписок он не звался никогда, и Home Assistant показывал все
      // переключатели живыми даже после остановки службы из трея: и `online`,
      // и состояния слотов уходят retained. Падение и reboot перекрыты
      // завещанием брокеру (см. mqtt/service.js).
      let stopping = false;
      const shutdown = (signal) => {
        if (stopping) return;
        stopping = true;
        log(`${signal}: снимаю доступность в Home Assistant и отключаюсь`);
        service.stop();
        process.exit(0);
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    });

  program.command('stats').action(() => {
    const stats = winMan.getStats();
    console.log(stats);
  });

  program.command('dashboard').action(async () => {
    const config = winMan.getConfig();
    const { resolveMatchList } = await import('./store.js');

    let stats = {};
    try {
      stats = winMan.getStats();
    } catch (e) {
      stats = { error: e.message };
    }

    let store = {};
    try {
      if (config.store?.path && fs.existsSync(config.store.path)) {
        store = JSON.parse(fs.readFileSync(config.store.path, 'utf8'));
      }
    } catch (e) {
      store = { error: e.message };
    }

    const cfgPath = config._configPath || '';
    let configContent = '';
    try {
      if (cfgPath && fs.existsSync(cfgPath)) {
        configContent = fs.readFileSync(cfgPath, 'utf8');
      }
    } catch (e) {
      configContent = 'Error reading config: ' + e.message;
    }

    const logPath = path.resolve(process.cwd(), 'data/windows11-manager.log');
    let logTail = [];
    try {
      if (fs.existsSync(logPath)) {
        const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
        logTail = lines.slice(-10);
      }
    } catch (e) {
      logTail = ['Error reading log: ' + e.message];
    }

    let apps = [];
    try { apps = winMan.getAppsWithIcons(); } catch (e) { apps = []; }

    let matchList = [];
    try { matchList = resolveMatchList(config); } catch (e) { matchList = []; }

    console.log(JSON.stringify({ stats, store, apps, matchList, configPath: cfgPath, configContent, logPath, logTail }));
    process.exit(0);
  });

  const claudeWt = program.command('claude-wt').description('remember Claude Code window positions');

  claudeWt.command('watch').action(async () => {
    const mod = await import('./claude-wt/index.js');
    mod.startClaudeWt();
    // Уход по сигналу — единственный способ остановиться по-хорошему:
    // stopClaudeWt() убирает опубликованный файл окон, и сторож в MQTT-службе не
    // найдёт в нём pid процесса, которого больше нет. Демон, снятый жёстко
    // (из трея это TerminateProcess, и обработчик не позовут), файл, конечно,
    // оставит — на этот случай у сторожа срок годности pid.
    let stopping = false;
    const shutdown = (signal) => {
      if (stopping) return;
      stopping = true;
      console.log(`[claude-wt] ${signal}: останавливаюсь и убираю файл окон`);
      mod.stopClaudeWt();
      process.exit(0);
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });

  claudeWt.command('status').action(async () => {
    const mod = await import('./claude-wt/index.js');
    console.log(JSON.stringify(mod.claudeWtStatus(), null, 2));
    process.exit(0);
  });

  claudeWt
    .command('restore')
    .description('alias for "snapshots-restore last"')
    .option('--session <id...>', 'restore only these sessions from the snapshot')
    .option('--slots', 'restore from the live slots instead of a snapshot (legacy)')
    .option('--force', 'with --slots: bring back only the sessions that are missing')
    .action(async (options) => {
      const mod = await import('./claude-wt/restore.js');
      // По умолчанию — самый свежий снимок. lastLayout обнуляется через секунду
      // после закрытия окон (демон переписывает его тем, что видит на экране),
      // поэтому восстановление по нему работало только сразу после перезагрузки.
      const { skipped } = options.slots
        ? await mod.restoreClaudeSessions({ force: options.force, sessionIds: options.session })
        : await mod.restoreSnapshot({ id: 'last', sessionIds: options.session });
      process.exit(skipped.length ? 1 : 0);
    });

  claudeWt
    .command('snapshots-list')
    .description('list remembered session layouts')
    .option('--json', 'print the raw structure instead of a table')
    .action(async (options) => {
      const mod = await import('./claude-wt/snapshotter.js');
      const { getClaudeWtConfig } = await import('./claude-wt/index.js');
      const snapshots = mod.listSnapshots(getClaudeWtConfig());
      if (options.json) {
        console.log(JSON.stringify({ ok: true, snapshots }, null, 2));
        process.exit(0);
      }
      if (!snapshots.length) console.log('[claude-wt] no snapshots yet');
      for (const s of snapshots) {
        console.log(`${s.id}  ${s.sessions.length} session(s)`);
        for (const x of s.sessions) {
          const where = `desktop ${x.desktop ?? '—'} · monitor ${x.monitor ?? '—'}`;
          console.log(`    ${x.title || x.id}  (${where})`);
        }
      }
      process.exit(0);
    });

  claudeWt
    .command('snapshots-restore [id]')
    .description('bring back a remembered layout ("last" for the newest)')
    .option('--session <id...>', 'restore only these sessions from the snapshot')
    .action(async (id, options) => {
      const mod = await import('./claude-wt/restore.js');
      const { skipped } = await mod.restoreSnapshot({ id: id ?? 'last', sessionIds: options.session });
      process.exit(skipped.length ? 1 : 0);
    });

  claudeWt
    .command('windows-clear')
    .description('remove the published windows file of a daemon that is no longer running')
    .action(async () => {
      const mod = await import('./claude-wt/index.js');
      const { windowsFile } = mod.getClaudeWtConfig();
      mod.removeWindowsFile(windowsFile);
      console.log(`[claude-wt] cleared ${windowsFile || '(windowsFile not set)'}`);
      process.exit(0);
    });

  claudeWt.command('clear').action(async () => {
    const mod = await import('./claude-wt/index.js');
    const { statePath } = mod.getClaudeWtConfig();
    if (statePath && fs.existsSync(statePath)) fs.unlinkSync(statePath);
    console.log(`[claude-wt] cleared ${statePath}`);
    process.exit(0);
  });

  claudeWt
    .command('open-project')
    .description('focus the last open session for a project cwd, or spawn a fresh named Claude')
    .requiredOption('--cwd <path>', 'Linux project directory')
    .requiredOption('--name <name>', 'display name for a newly spawned session')
    .action(async (options) => {
      const mod = await import('./claude-wt/project.js');
      const res = await mod.openClaudeProject({ cwd: options.cwd, name: options.name });
      console.log(JSON.stringify(res, null, 2));
      process.exit(res.ok ? 0 : 1);
    });

  program
    .command('config-dump')
    .description('показать разобранный конфиг: по умолчанию YAML, при --json — JSON')
    .argument('[path]', 'путь к конфигу; по умолчанию — тот, что выбрал бы менеджер')
    .option('--json', 'вывести JSON вместо YAML')
    .action(async (file, options) => {
      const { dumpConfig } = await import('./commands/config-commands.js');
      // Диагностическая команда обязана объяснять отказ словами: сырой стек
      // ловит тот, у кого выкатка уже выглядит сломанной.
      let out;
      try {
        out = dumpConfig(file, { json: options.json });
      } catch (e) {
        console.error(e.message);
        process.exit(1);
      }
      console.log(out);
      process.exit(0);
    });

  program
    .command('config-verify')
    .description('сравнить два конфига (.json-снимок или .yaml) и показать расхождения')
    .argument('<a>', 'первый файл')
    .argument('<b>', 'второй файл')
    .action(async (a, b) => {
      const { verifyConfigs } = await import('./commands/config-commands.js');
      let result;
      try {
        result = verifyConfigs(a, b);
      } catch (e) {
        console.error(e.message);
        process.exit(1);
      }
      for (const line of result.lines) console.log(line);
      process.exit(result.ok ? 0 : 1);
    });

  program.allowExcessArguments();
  program.parse();
}
