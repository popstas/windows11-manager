import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let file;
vi.mock('../config.js', () => ({ getConfig: () => ({}), resolveConfigPath: () => file }));

const { writeClaudeConfig } = await import('./claude-config-commands.js');

const YAML = `claudeWt:
  enabled: true
  # как ставить детей head
  childPlacement: stack
`;

describe('writeClaudeConfig — claudeWt.childPlacement', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-config-'));
    file = path.join(dir, 'windows11-manager.config.yaml');
    fs.writeFileSync(file, YAML);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('free меняет одно значение, комментарий и прочее на месте', () => {
    expect(writeClaudeConfig({ 'claudeWt.childPlacement': 'free' })).toEqual(['claudeWt.childPlacement']);
    expect(fs.readFileSync(file, 'utf8')).toBe(YAML.replace('childPlacement: stack', 'childPlacement: free'));
  });

  it('чужое значение — отказ, файл не тронут', () => {
    expect(() => writeClaudeConfig({ 'claudeWt.childPlacement': 'mosaic' })).toThrow(/ожидается одно из stack \| free \| deck/);
    expect(fs.readFileSync(file, 'utf8')).toBe(YAML);
  });
});
