#!/usr/bin/env node
/**
 * Обёртка переподключения вокруг ssh в окне терминала (WezTerm).
 *
 *   node ssh-reconnect.js [--retry <base64(JSON argv)>] -- <command> [args...]
 *
 * Запускает команду с унаследованной консолью и ждёт её. ssh вышел с потерей
 * связи (255 / -1) — печатает приглашение: Enter запускает команду повтора
 * (ту же сессию по id), любая другая клавиша или Ctrl+C — выход с 0, и
 * WezTerm закрывает панель (`exit_behavior = CloseOnCleanExit`). Правила
 * выбора — `nextStep()` в reconnect-helpers.js.
 *
 * Собирает эту командную строку `planWtLaunch()` (project-helpers.js) для
 * терминала с `reconnect: true` в реестре `claudeWt.terminals`.
 *
 * Пока команда жива, обёртка stdin не трогает вовсе — иначе забирала бы себе
 * нажатия, адресованные ssh. Клавишу приглашения читает отдельный дочерний
 * процесс (`--read-key`): у него своё чтение консоли, и оно кончается вместе
 * с ним, а не висит в этом процессе до следующего ssh.
 */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { isEnterKey, nextStep, parseWrapperArgs, exitCodeFor } from './reconnect-helpers.js';

const SELF = fileURLToPath(import.meta.url);

function readKeyMode() {
  const stdin = process.stdin;
  if (!stdin.isTTY) process.exit(1);
  stdin.setRawMode(true);
  stdin.once('data', (chunk) => {
    stdin.setRawMode(false);
    process.exit(isEnterKey(chunk) ? 0 : 1);
  });
}

function run(argv) {
  const started = Date.now();
  const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', windowsHide: false });
  if (r.error) {
    process.stderr.write(`ssh-reconnect: ${argv[0]}: ${r.error.message}\n`);
    return { code: 1, elapsedMs: Date.now() - started };
  }
  return { code: r.status, elapsedMs: Date.now() - started };
}

function ask(message) {
  process.stdout.write(`\r\n\x1b[33m${message}\x1b[0m\r\n`);
  const r = spawnSync(process.execPath, [SELF, '--read-key'], { stdio: 'inherit' });
  return r.status === 0;
}

function main(argv) {
  if (argv[0] === '--read-key') return readKeyMode();
  const parsed = parseWrapperArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.reason}\n`);
    process.exit(2);
  }
  // Ctrl+C до того, как ssh перевёл консоль в сырой режим, не должен убить
  // обёртку раньше ssh: решает код его выхода, а не сигнал.
  process.on('SIGINT', () => {});
  let attempt = 'original';
  for (;;) {
    const argvNow = attempt === 'retry' ? parsed.retry : parsed.original;
    const { code, elapsedMs } = run(argvNow);
    const step = nextStep({ code, attempt, elapsedMs, hasRetry: Boolean(parsed.retry) });
    if (step.kind === 'exit') process.exit(exitCodeFor(step.code));
    if (!ask(step.message)) process.exit(0);
    attempt = step.next;
    process.stdout.write('\r\nПереподключение…\r\n');
  }
}

main(process.argv.slice(2));
