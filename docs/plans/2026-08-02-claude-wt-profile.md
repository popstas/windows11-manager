# Claude WT profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configurable Windows Terminal profile (`-p`) for claude-wt launches: empty by default, set via `claudeWt.profile`, overridable per `claudeProjects[].profile` on project spawn.

**Architecture:** Pure `applyWtProfile(args, profile)` strips any existing `-p` pair and reinjects the resolved profile after `-w <n>` when non-empty. `planLaunchNew` / `planRestore` / `planSnapshotRestore` call it; `openClaudeProject` resolves `project.profile ?? cfg.profile ?? ''`. windows-mqtt only forwards `profile` from yaml through `resolveClaudeProject`.

**Tech Stack:** Node.js ESM + vitest (windows11-manager); CommonJS node:test (windows-mqtt helpers).

Дизайн: `docs/specs/2026-08-02-claude-wt-profile-design.md`.

## Global Constraints

- Чистая логика в `*-helpers.js` без `fs` / `child_process` / `node-window-manager`.
- Тесты: `npx vitest run <path>` в windows11-manager; `node --test test/claude-project-helpers.test.js` в windows-mqtt.
- `ssh_app` / пикер session-open / Rust hotkey parser — вне скоупа.
- Conventional commits, по одному на задачу.
- После правок, нужных живому windows-mqtt: `npm run deploy-fast` из `D:/projects/js/windows-mqtt` (только node).

## File map

| File | Role |
|---|---|
| `src/claude-wt/wt-profile-helpers.js` | `applyWtProfile` |
| `src/claude-wt/project-helpers.js` | `planLaunchNew` принимает `profile` |
| `src/claude-wt/project.js` | resolve + pass profile |
| `src/claude-wt/daemon-helpers.js` | `profile: ''` default |
| `src/claude-wt/restore-helpers.js` | `planRestore` + profile |
| `src/claude-wt/snapshot-helpers.js` | `planSnapshotRestore` + profile |
| `src/claude-wt/restore.js` | pass `cfg.profile` into planners |
| `config.example.cjs` | no hardcoded `-p popstas` |
| `../windows-mqtt/src/picker/claude-project-helpers.js` | forward `profile` |
| `../windows-mqtt/src/modules/windows.js` | pass profile to `openClaudeProject` |
| `../windows-mqtt/config.example.yml` | document optional `profile` |

---

### Task 1: `applyWtProfile`

**Files:**
- Create: `src/claude-wt/wt-profile-helpers.js`
- Create: `src/claude-wt/wt-profile-helpers.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `applyWtProfile(args: string[], profile: string|null|undefined) → string[]`
  - Copy args; drop every `-p` + following token.
  - If `profile` is a non-empty string, insert `['-p', profile]` after `-w <n>` (when args start with `-w` and have a next token), else at index 0.
  - Falsy / empty profile → stripped args only, no `-p`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from 'vitest';
import { applyWtProfile } from './wt-profile-helpers.js';

describe('applyWtProfile', () => {
  it('inserts -p after -w <n>', () => {
    expect(applyWtProfile(['-w', '-1', 'ssh', 'host'], 'home')).toEqual([
      '-w', '-1', '-p', 'home', 'ssh', 'host',
    ]);
  });

  it('strips an existing -p before reinjecting', () => {
    expect(applyWtProfile(['-w', '-1', '-p', 'popstas', 'ssh'], 'home')).toEqual([
      '-w', '-1', '-p', 'home', 'ssh',
    ]);
  });

  it('omits -p when profile is empty', () => {
    expect(applyWtProfile(['-w', '-1', '-p', 'popstas', 'ssh'], '')).toEqual([
      '-w', '-1', 'ssh',
    ]);
    expect(applyWtProfile(['ssh'], undefined)).toEqual(['ssh']);
  });

  it('inserts at the start when there is no -w pair', () => {
    expect(applyWtProfile(['ssh', 'host'], 'home')).toEqual(['-p', 'home', 'ssh', 'host']);
  });

  it('does not mutate the input array', () => {
    const args = ['-w', '-1', 'ssh'];
    applyWtProfile(args, 'x');
    expect(args).toEqual(['-w', '-1', 'ssh']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/claude-wt/wt-profile-helpers.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement**

```js
/** Strip existing -p pairs and optionally reinject a WT profile. Pure. */
function applyWtProfile(args, profile) {
  const src = Array.isArray(args) ? args : [];
  const stripped = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '-p') {
      i += 1; // skip profile name
      continue;
    }
    stripped.push(src[i]);
  }
  const name = typeof profile === 'string' ? profile.trim() : '';
  if (!name) return stripped;

  let insertAt = 0;
  if (stripped[0] === '-w' && stripped.length >= 2) insertAt = 2;
  return [...stripped.slice(0, insertAt), '-p', name, ...stripped.slice(insertAt)];
}

export { applyWtProfile };
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npx vitest run src/claude-wt/wt-profile-helpers.test.js`

- [ ] **Step 5: Commit**

```bash
git add src/claude-wt/wt-profile-helpers.js src/claude-wt/wt-profile-helpers.test.js
git commit -m "feat(claude-wt): applyWtProfile strip-and-reinject helper"
```

---

### Task 2: `planLaunchNew` + config default + project spawn

**Files:**
- Modify: `src/claude-wt/project-helpers.js`
- Modify: `src/claude-wt/project-helpers.test.js`
- Modify: `src/claude-wt/project.js`
- Modify: `src/claude-wt/daemon-helpers.js`
- Modify: `src/claude-wt/daemon-helpers.test.js` (assert `profile: ''` in defaults equality — `mergeClaudeWtConfig(undefined)` already deep-equals `CLAUDE_WT_DEFAULTS`, so updating defaults is enough if that test still passes)
- Modify: `config.example.cjs`

**Interfaces:**
- Consumes: `applyWtProfile` from Task 1.
- Produces:
  - `planLaunchNew({ launchNew, cwd, name, profile })` — after `{cwd}`/`{name}` substitution, `args = applyWtProfile(args, profile)`.
  - `openClaudeProject({ cwd, name, profile })` — `effective = profile ?? cfg.profile ?? ''`, pass to `planLaunchNew`.
  - `CLAUDE_WT_DEFAULTS.profile = ''`.

- [ ] **Step 1: Extend failing tests in `project-helpers.test.js`**

```js
import { applyWtProfile } from './wt-profile-helpers.js'; // only if needed — prefer testing via planLaunchNew

describe('planLaunchNew', () => {
  // existing tests stay; they pass profile undefined → no -p

  it('applies a WT profile after substitution', () => {
    expect(planLaunchNew({
      launchNew: {
        command: 'wt.exe',
        args: ['-w', '-1', 'ssh', '-t', "cd '{cwd}' && exec claude -n '{name}'"],
      },
      cwd: '/p/home',
      name: 'home',
      profile: 'home',
    })).toEqual({
      command: 'wt.exe',
      args: ['-w', '-1', '-p', 'home', 'ssh', '-t', "cd '/p/home' && exec claude -n 'home'"],
    });
  });

  it('strips a baked-in -p when profile is empty', () => {
    expect(planLaunchNew({
      launchNew: {
        command: 'wt.exe',
        args: ['-w', '-1', '-p', 'popstas', 'ssh'],
      },
      cwd: '/p',
      name: 'x',
      profile: '',
    }).args).toEqual(['-w', '-1', 'ssh']);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/claude-wt/project-helpers.test.js`

- [ ] **Step 3: Implement**

In `project-helpers.js`:

```js
import { applyWtProfile } from './wt-profile-helpers.js';

function planLaunchNew({ launchNew, cwd, name, profile }) {
  const safeCwd = escapeForSingleQuoted(cwd ?? '');
  const safeName = escapeForSingleQuoted(name ?? '');
  const substituted = (launchNew.args ?? []).map(arg =>
    String(arg).replaceAll('{cwd}', safeCwd).replaceAll('{name}', safeName)
  );
  return {
    command: launchNew.command,
    args: applyWtProfile(substituted, profile),
  };
}
```

In `daemon-helpers.js` add `profile: ''` next to `debug: false` in `CLAUDE_WT_DEFAULTS`.

In `project.js` `openClaudeProject`:

```js
async function openClaudeProject({ cwd, name, profile } = {}) {
  // ... existing validation and focus paths unchanged ...
  const cfg = getClaudeWtConfig();
  if (!cfg.launchNew?.command) {
    return { ok: false, reason: 'claudeWt.launchNew.command is not set in config' };
  }
  const effectiveProfile = profile ?? cfg.profile ?? '';
  const { command, args } = planLaunchNew({
    launchNew: cfg.launchNew,
    cwd,
    name: sessionName,
    profile: effectiveProfile,
  });
  // ... spawn unchanged ...
}
```

In `config.example.cjs`:

```js
claudeWt: {
  // profile: 'your_wt_profile', // optional; omit → no -p
  launch: {
    command: 'wt.exe',
    args: ['-w', '-1', 'ssh', '-A', 'user@host',
           '-t', 'ccfzf --session {id} --kiosk'],
  },
  launchNew: {
    command: 'wt.exe',
    args: ['-w', '-1', 'ssh', '-A', 'user@host',
           '-t', "cd '{cwd}' && exec claude -n '{name}'"],
  },
  // ...
}
```

Remove every `-p', 'popstas'` from example args.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/claude-wt/project-helpers.test.js src/claude-wt/daemon-helpers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/claude-wt/project-helpers.js src/claude-wt/project-helpers.test.js \
  src/claude-wt/project.js src/claude-wt/daemon-helpers.js config.example.cjs
git commit -m "feat(claude-wt): profile on launchNew and config default"
```

---

### Task 3: Restore + snapshot launch planners

**Files:**
- Modify: `src/claude-wt/restore-helpers.js`
- Modify: `src/claude-wt/restore-helpers.test.js`
- Modify: `src/claude-wt/snapshot-helpers.js`
- Modify: `src/claude-wt/snapshot-helpers.test.js`
- Modify: `src/claude-wt/restore.js`

**Interfaces:**
- Consumes: `applyWtProfile`.
- Produces:
  - `planRestore({ state, launch, sessionIds, profile })` — after `{id}` replace, `applyWtProfile(..., profile)`.
  - `planSnapshotRestore({ ..., launch, profile })` — same.
  - `restore.js` passes `profile: cfg.profile` into both.

- [ ] **Step 1: Failing tests**

In `restore-helpers.test.js` add:

```js
it('applies WT profile after {id} substitution', () => {
  const launch = { command: 'wt.exe', args: ['-w', '-1', 'ssh', '-t', 'ccfzf --session {id}'] };
  expect(planRestore({ state: state(), launch, profile: 'popstas' })[0].args).toEqual([
    '-w', '-1', '-p', 'popstas', 'ssh', '-t', 'ccfzf --session a1',
  ]);
});

it('strips baked-in -p when profile is empty', () => {
  const launch = { command: 'wt.exe', args: ['-w', '-1', '-p', 'old', 'ssh'] };
  expect(planRestore({ state: state(), launch, profile: '' })[0].args).toEqual([
    '-w', '-1', 'ssh',
  ]);
});
```

In `snapshot-helpers.test.js` add one case:

```js
it('applies WT profile to snapshot restore args', () => {
  const [item] = planSnapshotRestore({
    snapshot,
    openSessionIds: new Set(['b', 'c']),
    launch: { command: 'wt.exe', args: ['-w', '-1', 'ssh', 'ccfzf --session {id}'] },
    profile: 'popstas',
  });
  expect(item.args).toEqual(['-w', '-1', '-p', 'popstas', 'ssh', 'ccfzf --session a']);
});
```

(Use the existing `snapshot` fixture from that describe block; adjust session id to match the first missing session the current tests use.)

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/claude-wt/restore-helpers.test.js src/claude-wt/snapshot-helpers.test.js`

- [ ] **Step 3: Implement**

`restore-helpers.js`:

```js
import { applyWtProfile } from './wt-profile-helpers.js';

function planRestore({ state, launch, sessionIds, profile }) {
  return (resolveRestoreIds({ state, sessionIds }).ids)
    .map(sessionId => ({ sessionId, slot: state.slots?.[sessionId] }))
    .filter(({ slot }) => Boolean(slot))
    .map(({ sessionId, slot }) => ({
      sessionId,
      title: slot.titles[0],
      command: launch.command,
      args: applyWtProfile(
        launch.args.map(arg => arg.replaceAll('{id}', sessionId)),
        profile,
      ),
      bounds: slot.bounds,
      desktop: slot.desktop,
    }));
}
```

`snapshot-helpers.js` — same pattern on the `args:` line of `planSnapshotRestore`.

`restore.js`:

```js
const fullPlan = planRestore({ state, launch: cfg.launch, sessionIds, profile: cfg.profile });
// ...
const plan = planSnapshotRestore({
  snapshot,
  openSessionIds: openSessionIds(cfg, state),
  sessionIds,
  launch: cfg.launch,
  profile: cfg.profile,
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/claude-wt/restore-helpers.test.js src/claude-wt/snapshot-helpers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/claude-wt/restore-helpers.js src/claude-wt/restore-helpers.test.js \
  src/claude-wt/snapshot-helpers.js src/claude-wt/snapshot-helpers.test.js \
  src/claude-wt/restore.js
git commit -m "feat(claude-wt): apply profile on restore and snapshot launch"
```

---

### Task 4: windows-mqtt — forward `profile` from `claudeProjects`

Working directory: `D:/projects/js/windows-mqtt` (separate git repo).

**Files:**
- Modify: `src/picker/claude-project-helpers.js`
- Modify: `test/claude-project-helpers.test.js`
- Modify: `src/modules/windows.js` (`claudeFocusProject`)
- Modify: `config.example.yml`

**Interfaces:**
- Consumes: `openClaudeProject({ cwd, name, profile })` from windows11-manager Task 2.
- Produces: `resolveClaudeProject` returns `profile` when present on the yaml entry (string); omit key or leave undefined when absent.

- [ ] **Step 1: Failing test**

In `test/claude-project-helpers.test.js`:

```js
test('forwards optional profile from the project entry', () => {
  const withProfile = [
    { name: 'home', cwd: '/home/popstas/projects/text/obsidian/home', hotkey: 'Ctrl+F11', profile: 'home' },
  ];
  assert.deepEqual(
    resolveClaudeProject(withProfile, { name: 'home' }),
    {
      name: 'home',
      cwd: '/home/popstas/projects/text/obsidian/home',
      hotkey: 'Ctrl+F11',
      profile: 'home',
    }
  );
});

test('omits profile when the entry has none', () => {
  const out = resolveClaudeProject(projects, { name: 'home' });
  assert.equal(out.profile, undefined);
});
```

Update existing `resolves by name` expectation only if it would break — with the new optional field, deepEqual should still match objects without `profile`.

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test test/claude-project-helpers.test.js`

- [ ] **Step 3: Implement**

`claude-project-helpers.js` — when building the return object, include profile if set:

```js
function projectFields(hit) {
  const out = { name: hit.name, cwd: hit.cwd, hotkey: hit.hotkey };
  if (typeof hit.profile === 'string' && hit.profile) out.profile = hit.profile;
  return out;
}
```

Use `projectFields(hit)` in both name and cwd branches (replace the current inline `{ name, cwd, hotkey }`).

`windows.js` `claudeFocusProject`:

```js
res = await winMan.openClaudeProject({
  cwd: project.cwd,
  name: project.name,
  profile: project.profile,
});
```

`config.example.yml`:

```yaml
claudeProjects:
  - name: home
    cwd: /home/popstas/projects/text/obsidian/home
    hotkey: Ctrl+F11
    # profile: home   # optional WT profile; overrides claudeWt.profile for spawn
  - name: expertizeme
    cwd: /home/popstas/projects/text/obsidian/ExpertizeMe
    hotkey: Ctrl+F12
    # profile: ExpertizeMe
```

- [ ] **Step 4: Run tests**

Run: `node --test test/claude-project-helpers.test.js test/tauri-config.test.js`
Expected: PASS (`tauri-config` only requires name/cwd/hotkey)

- [ ] **Step 5: Commit + deploy-fast**

```bash
git add src/picker/claude-project-helpers.js test/claude-project-helpers.test.js \
  src/modules/windows.js config.example.yml
git commit -m "feat(claude-wt): forward claudeProjects.profile to openClaudeProject"
npm run deploy-fast
```

---

### Task 5: Live personal config (manual, no repo commit)

Not a git task — apply after Tasks 1–4 so the running app matches the design.

**File:** `C:/Users/popstas/AppData/Roaming/windows-mqtt/windows11-manager.config.js`

- [ ] Set `claudeWt.profile: 'popstas'`.
- [ ] Remove `'-p', 'popstas'` from both `launch.args` and `launchNew.args`.
- [ ] Confirm `claudeProjects` in `…/windows-mqtt/config.yml` still has `profile: home` / `profile: ExpertizeMe`.
- [ ] Restart windows-mqtt / tray so config reloads.
- [ ] Smoke: Ctrl+F11 → WT opens with `-p home`; a restore/launch without project uses `-p popstas`.

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| `claudeWt.profile`, default empty | 2 |
| No `-p` in example args | 2 |
| `applyWtProfile` strip-and-reinject | 1 |
| `planLaunchNew` + project override | 2 |
| restore / snapshot use `cfg.profile` | 3 |
| `resolveClaudeProject` + `claudeFocusProject` | 4 |
| example yml documents profile | 4 |
| Personal config migration | 5 |
| `ssh_app` untouched | (out of scope) |
| Rust parser untouched | (out of scope) |
