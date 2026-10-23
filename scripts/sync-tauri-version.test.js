import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setLockVersion, setManifestVersion, PLUGIN_MANIFESTS } from './sync-tauri-version.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(rootDir, rel), 'utf8');

describe('setLockVersion', () => {
  const lock = [
    'version = 4',
    '',
    '[[package]]',
    'name = "adler2"',
    'version = "2.0.1"',
    '',
    '[[package]]',
    'name = "windows11-manager-tray"',
    'version = "4.1.0"',
    'dependencies = [',
    '',
  ].join('\n');

  it('правит версию своего пакета и не трогает чужую', () => {
    const next = setLockVersion(lock, 'windows11-manager-tray', '4.3.0');
    expect(next).toContain('name = "windows11-manager-tray"\nversion = "4.3.0"');
    expect(next).toContain('name = "adler2"\nversion = "2.0.1"');
    expect(next).toContain('version = 4\n');
  });

  it('понимает CRLF', () => {
    const next = setLockVersion(lock.replace(/\n/g, '\r\n'), 'windows11-manager-tray', '4.3.0');
    expect(next).toContain('name = "windows11-manager-tray"\r\nversion = "4.3.0"');
  });
});

describe('setManifestVersion', () => {
  it('правит верхнюю версию, metadata и plugins[]', () => {
    const next = JSON.parse(setManifestVersion(JSON.stringify({
      name: 'x', metadata: { version: '1.0.0' }, plugins: [{ name: 'x', version: '1.0.0' }],
    }), '2.0.0'));
    expect(next.metadata.version).toBe('2.0.0');
    expect(next.plugins[0].version).toBe('2.0.0');
    expect('version' in next).toBe(false);
  });
});

describe('версии в репозитории', () => {
  const { version } = JSON.parse(read('package.json'));

  it('манифесты плагина сходятся с package.json', () => {
    for (const rel of PLUGIN_MANIFESTS) {
      expect(setManifestVersion(read(rel), version), rel).toBe(read(rel));
    }
  });

  it('Cargo.lock называет свой пакет той же версией', () => {
    const lock = read('tauri-app/src-tauri/Cargo.lock');
    expect(setLockVersion(lock, 'windows11-manager-tray', version)).toBe(lock);
    expect(lock).toContain(`name = "windows11-manager-tray"\nversion = "${version}"`.replace(/\n/g, lock.includes('\r\n') ? '\r\n' : '\n'));
  });

  it('оба манифеста плагина описывают одно и то же', () => {
    const claude = JSON.parse(read('.claude-plugin/plugin.json'));
    const codex = JSON.parse(read('.codex-plugin/plugin.json'));
    expect(codex.name).toBe(claude.name);
    expect(codex.description).toBe(claude.description);
    expect(fs.existsSync(path.join(rootDir, codex.skills))).toBe(true);
  });

  it('у каждого скилла есть SKILL.md с именем каталога', () => {
    const dir = path.join(rootDir, 'skills');
    for (const name of fs.readdirSync(dir)) {
      expect(read(`skills/${name}/SKILL.md`), name).toMatch(new RegExp(`^---\\nname: ${name}\\n`));
    }
  });
});
