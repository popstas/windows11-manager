# Claude WT unified launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One WT argv builder + spawn path for restore/snapshot/project/picker-Terminal; `claudeWt.projects` in manager config with cwd→profile resolution; mqtt/Rust consume projects via JS API.

**Architecture:** Pure `profileForCwd` + `planWtLaunch` in windows11-manager. Restore planners resolve profile per session cwd. `claudeProjects` leave mqtt yaml; `claudeWtProjects()` exported for node and for Rust one-shot ESM dump at hotkey registration.

**Tech Stack:** Node.js ESM + vitest (windows11-manager); CommonJS node:test + Tauri/Rust (windows-mqtt).

Дизайн: `docs/specs/2026-08-03-claude-wt-unified-launch-design.md`.

## Global Constraints

- Чистая логика в `*-helpers.js` без `fs` / `child_process` / `node-window-manager`.
- Тесты: `npx vitest run <path>` в windows11-manager; `node --test test/…` в windows-mqtt; Rust: `cargo test` в `src-tauri` где затронуто.
- Exact cwd match для projects; `profileForCwd` = matching `project.profile ?? cfg.profile ?? ''`.
- Picker Terminal = `restoreClaudeSessions({ sessionIds: [id] })`, не `sshApp`.
- Rust: ESM one-shot `claudeWtProjects()`, не `require`, не yaml `claudeProjects`.
- Conventional commits, по одному на задачу.
- После правок живого windows-mqtt: `npm run deploy-fast` из `D:/projects/js/windows-mqtt` (node); если трогали Rust — нужен полный rebuild/`deploy-local` (отметить в задаче).
- Ветки: `feat/claude-wt-agent-progress` (manager), `feat/session-picker-agent-state` (mqtt).

## File map

| File | Role |
|---|---|
| `src/claude-wt/project-helpers.js` | `normalizeProjects`, `profileForCwd`, `planWtLaunch`; `planLaunchNew` → wrapper |
| `src/claude-wt/daemon-helpers.js` | `projects: []` default; clone projects in merge |
| `src/claude-wt/index.js` | `claudeWtProjects()` |
| `src/claude-wt/restore-helpers.js` | `planRestore` per-item `resolveProfile(cwd)` |
| `src/claude-wt/snapshot-helpers.js` | same for snapshot |
| `src/claude-wt/restore.js` | pass `resolveProfile` from cfg |
| `src/claude-wt/project.js` | use `profileForCwd` / `planWtLaunch` |
| `config.example.cjs` | commented `projects` |
| `../windows-mqtt/src/modules/windows.js` | projects from API; Terminal → restore |
| `../windows-mqtt/config.example.yml` | remove `claudeProjects` |
| `../windows-mqtt/src-tauri/src/main.rs` | node dump projects; drop yaml parse |
| `../windows-mqtt/test/*` | update expectations |

---

### Task 1: `projects` + `profileForCwd` + `claudeWtProjects`

**Files:**
- Modify: `src/claude-wt/project-helpers.js`
- Modify: `src/claude-wt/project-helpers.test.js`
- Modify: `src/claude-wt/daemon-helpers.js`
- Modify: `src/claude-wt/daemon-helpers.test.js` (defaults still deep-equal after `projects: []`)
- Modify: `src/claude-wt/index.js`
- Modify: `config.example.cjs`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `normalizeProjects(raw) → [{ name, cwd, hotkey?, profile? }, …]` — keep entries with non-empty string `name`+`cwd`; copy optional string `hotkey`/`profile` when non-empty after trim (or keep empty profile as absent — match current `projectFields`: only include profile when non-empty string).
  - `profileForCwd(cwd, cfg) → string` — exact cwd match in `cfg.projects`; then `project.profile ?? cfg.profile ?? ''` (if matched project has no profile key, use cfg.profile).
  - `CLAUDE_WT_DEFAULTS.projects = []`; `mergeClaudeWtConfig` sets `projects: normalizeProjects(cfg.projects)`.
  - `claudeWtProjects()` → `normalizeProjects(getClaudeWtConfig().projects)` (or just return cfg.projects after merge).

- [ ] **Step 1: Failing tests**

In `project-helpers.test.js`:

```js
import { normalizeProjects, profileForCwd } from './project-helpers.js';

describe('normalizeProjects', () => {
  it('keeps complete entries and drops incomplete ones', () => {
    expect(normalizeProjects([
      { name: 'home', cwd: '/p/home', hotkey: 'Ctrl+F11', profile: 'home' },
      { name: 'x' },
      null,
    ])).toEqual([
      { name: 'home', cwd: '/p/home', hotkey: 'Ctrl+F11', profile: 'home' },
    ]);
  });
});

describe('profileForCwd', () => {
  const cfg = {
    profile: 'popstas',
    projects: [
      { name: 'home', cwd: '/p/home', profile: 'home' },
      { name: 'ez', cwd: '/p/ExpertizeMe' },
    ],
  };

  it('uses project profile on exact cwd match', () => {
    expect(profileForCwd('/p/home', cfg)).toBe('home');
  });

  it('falls back to cfg.profile when project has no profile', () => {
    expect(profileForCwd('/p/ExpertizeMe', cfg)).toBe('popstas');
  });

  it('falls back to cfg.profile when cwd is unknown', () => {
    expect(profileForCwd('/other', cfg)).toBe('popstas');
  });

  it('returns empty when no project and no cfg.profile', () => {
    expect(profileForCwd('/other', { profile: '', projects: [] })).toBe('');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/claude-wt/project-helpers.test.js`

- [ ] **Step 3: Implement**

```js
function normalizeProjects(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const p of raw) {
    if (!p || typeof p.name !== 'string' || !p.name || typeof p.cwd !== 'string' || !p.cwd) continue;
    const entry = { name: p.name, cwd: p.cwd };
    if (typeof p.hotkey === 'string' && p.hotkey.trim()) entry.hotkey = p.hotkey.trim();
    if (typeof p.profile === 'string' && p.profile.trim()) entry.profile = p.profile.trim();
    out.push(entry);
  }
  return out;
}

function profileForCwd(cwd, cfg = {}) {
  const projects = Array.isArray(cfg.projects) ? cfg.projects : [];
  const hit = typeof cwd === 'string' && cwd
    ? projects.find(p => p.cwd === cwd)
    : undefined;
  if (hit && typeof hit.profile === 'string' && hit.profile) return hit.profile;
  return typeof cfg.profile === 'string' ? cfg.profile : '';
}
```

In `daemon-helpers.js`: add `projects: []` to defaults; in merge:
`projects: normalizeProjects(cfg.projects ?? CLAUDE_WT_DEFAULTS.projects)` —
import `normalizeProjects` from `./project-helpers.js` (watch circular imports: project-helpers must not import daemon-helpers).

In `index.js`:

```js
function claudeWtProjects() {
  return getClaudeWtConfig().projects;
}
```

Export it.

In `config.example.cjs` under `claudeWt`, after `profile` comment:

```js
    // projects: [
    //   { name: 'home', cwd: '/path/to/home', hotkey: 'Ctrl+F11', profile: 'home' },
    // ],
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/claude-wt/project-helpers.test.js src/claude-wt/daemon-helpers.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/claude-wt/project-helpers.js src/claude-wt/project-helpers.test.js \
  src/claude-wt/daemon-helpers.js src/claude-wt/index.js config.example.cjs
git commit -m "feat(claude-wt): projects list and profileForCwd"
```

---

### Task 2: `planWtLaunch` + per-session profile on restore/snapshot

**Files:**
- Modify: `src/claude-wt/project-helpers.js`
- Modify: `src/claude-wt/project-helpers.test.js`
- Modify: `src/claude-wt/restore-helpers.js`
- Modify: `src/claude-wt/restore-helpers.test.js`
- Modify: `src/claude-wt/snapshot-helpers.js`
- Modify: `src/claude-wt/snapshot-helpers.test.js`
- Modify: `src/claude-wt/restore.js`
- Modify: `src/claude-wt/project.js`

**Interfaces:**
- Consumes: `applyWtProfile`, `profileForCwd`, `escapeForSingleQuoted`.
- Produces:
  - `planWtLaunch({ launch, vars, profile }) → { command, args }`
    - Replace `{id}` with `vars.id ?? ''` (no escaping).
    - Replace `{cwd}` / `{name}` with single-quote-escaped values.
    - Then `applyWtProfile`.
  - `planLaunchNew` becomes `planWtLaunch({ launch: launchNew, vars: { cwd, name }, profile })`.
  - `planRestore({ state, launch, sessionIds, resolveProfile })` — per item `resolveProfile(slot.cwd ?? '')`.
  - `planSnapshotRestore({ …, resolveProfile })` — per item `resolveProfile(s.cwd ?? '')`.
  - `restore.js`: `resolveProfile: (cwd) => profileForCwd(cwd, cfg)` for both planners (drop single `profile: cfg.profile`).
  - `openClaudeProject`: `profileForCwd(cwd, cfg)` when caller omits profile, else `profile ?? profileForCwd(cwd, cfg)` — keep `profile ?? cfg.profile ?? ''` equivalent via `profile ?? profileForCwd(cwd, cfg)` only if undefined caller profile should still allow empty override… Spec: hotkey path uses `profileForCwd(project.cwd)`. Use `effective = profile !== undefined && profile !== null ? profile : profileForCwd(cwd, cfg)` OR simply always `profileForCwd(cwd, cfg)` when mqtt stops sending profile and project is in cfg.projects. Prefer: `const effective = profile ?? profileForCwd(cwd, cfg);` so explicit `profile` from caller still wins (mqtt may pass project.profile briefly during migration).

- [ ] **Step 1: Failing tests**

```js
// project-helpers.test.js
it('planWtLaunch substitutes id/cwd/name and applies profile', () => {
  expect(planWtLaunch({
    launch: { command: 'wt.exe', args: ['-w', '-1', 'ssh', '-t', 'ccfzf --session {id}'] },
    vars: { id: 'a1' },
    profile: 'home',
  })).toEqual({
    command: 'wt.exe',
    args: ['-w', '-1', '-p', 'home', 'ssh', '-t', 'ccfzf --session a1'],
  });
});

// restore-helpers.test.js — replace single-profile cases:
it('resolves profile per slot cwd', () => {
  const st = state({
    lastLayout: ['a1', 'b2'],
    slots: {
      a1: slot({ titles: ['home'], cwd: '/p/home' }),
      b2: slot({ titles: ['ez'], cwd: '/p/ez' }),
    },
  });
  const launch = { command: 'wt.exe', args: ['-w', '-1', 'ssh', '{id}'] };
  const resolveProfile = (cwd) => (cwd === '/p/home' ? 'home' : 'popstas');
  const plan = planRestore({ state: st, launch, resolveProfile });
  expect(plan[0].args).toEqual(['-w', '-1', '-p', 'home', 'ssh', 'a1']);
  expect(plan[1].args).toEqual(['-w', '-1', '-p', 'popstas', 'ssh', 'b2']);
});

// snapshot-helpers.test.js
it('resolves profile per snapshot session cwd', () => {
  const [item] = planSnapshotRestore({
    snapshot,
    openSessionIds: new Set(['b', 'c']),
    launch: { command: 'wt.exe', args: ['-w', '-1', 'ssh', 'ccfzf --session {id}'] },
    resolveProfile: (cwd) => (cwd === '/a' ? 'ExpertizeMe' : 'popstas'),
  });
  // first missing session in fixture is `a` with cwd `/a`
  expect(item.args).toEqual(['-w', '-1', '-p', 'ExpertizeMe', 'ssh', 'ccfzf --session a']);
});
```

Update any existing tests that passed `profile: '…'` to `resolveProfile: () => '…'`.

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/claude-wt/project-helpers.test.js src/claude-wt/restore-helpers.test.js src/claude-wt/snapshot-helpers.test.js`

- [ ] **Step 3: Implement**

```js
function planWtLaunch({ launch, vars = {}, profile }) {
  const id = vars.id ?? '';
  const safeCwd = escapeForSingleQuoted(vars.cwd ?? '');
  const safeName = escapeForSingleQuoted(vars.name ?? '');
  const substituted = (launch?.args ?? []).map(arg =>
    String(arg)
      .replaceAll('{id}', id)
      .replaceAll('{cwd}', safeCwd)
      .replaceAll('{name}', safeName)
  );
  return {
    command: launch.command,
    args: applyWtProfile(substituted, profile),
  };
}

function planLaunchNew({ launchNew, cwd, name, profile }) {
  return planWtLaunch({ launch: launchNew, vars: { cwd, name }, profile });
}
```

`planRestore`:

```js
function planRestore({ state, launch, sessionIds, resolveProfile }) {
  const resolve = typeof resolveProfile === 'function' ? resolveProfile : () => '';
  return (resolveRestoreIds({ state, sessionIds }).ids)
    .map(sessionId => ({ sessionId, slot: state.slots?.[sessionId] }))
    .filter(({ slot }) => Boolean(slot))
    .map(({ sessionId, slot }) => {
      const planned = planWtLaunch({
        launch,
        vars: { id: sessionId },
        profile: resolve(slot.cwd ?? ''),
      });
      return {
        sessionId,
        title: slot.titles[0],
        command: planned.command,
        args: planned.args,
        bounds: slot.bounds,
        desktop: slot.desktop,
      };
    });
}
```

Same pattern in `planSnapshotRestore` with `s.cwd`.

`restore.js`:

```js
import { profileForCwd } from './project-helpers.js';
// ...
const resolveProfile = (cwd) => profileForCwd(cwd, cfg);
const fullPlan = planRestore({ state, launch: cfg.launch, sessionIds, resolveProfile });
// ...
const plan = planSnapshotRestore({
  snapshot,
  openSessionIds: openSessionIds(cfg, state),
  sessionIds,
  launch: cfg.launch,
  resolveProfile,
});
```

`project.js`: `const effectiveProfile = profile ?? profileForCwd(cwd, cfg);`

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/claude-wt/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/claude-wt/project-helpers.js src/claude-wt/project-helpers.test.js \
  src/claude-wt/restore-helpers.js src/claude-wt/restore-helpers.test.js \
  src/claude-wt/snapshot-helpers.js src/claude-wt/snapshot-helpers.test.js \
  src/claude-wt/restore.js src/claude-wt/project.js
git commit -m "feat(claude-wt): planWtLaunch and per-cwd profile on restore"
```

---

### Task 3: windows-mqtt node — projects API + Terminal → restore

Working directory: `D:/projects/js/windows-mqtt`.

**Files:**
- Modify: `src/modules/windows.js`
- Modify: `config.example.yml`
- Modify: `test/tauri-config.test.js`
- Modify: `test/claude-project-helpers.test.js` (unchanged helpers OK; callers change)

**Interfaces:**
- Consumes: `winMan.claudeWtProjects()`, `winMan.restoreClaudeSessions`.
- Produces: no yaml `claudeProjects`; Terminal action reopen by id.

- [ ] **Step 1: Failing / update tests**

Replace `config.example.yml documents claudeProjects…` in `test/tauri-config.test.js` with:

```js
test('config.example.yml no longer defines claudeProjects (moved to windows11-manager)', () => {
  const config = yaml.load(fs.readFileSync(path.join(repoRoot, 'config.example.yml'), 'utf8'));
  assert.equal(config.claudeProjects, undefined);
});
```

- [ ] **Step 2: Run — expect FAIL** (example still has claudeProjects)

Run: `node --test test/tauri-config.test.js`

- [ ] **Step 3: Implement**

In `windows.js`:

```js
function claudeProjects() {
  try {
    return winMan.claudeWtProjects?.() ?? winMan.getClaudeWtConfig?.().projects ?? [];
  } catch {
    return [];
  }
}
```

Replace `globalConfig.claudeProjects` with `claudeProjects()` at `claudeFocusProject` and `attachProjectHotkeys`.

In `claudeSessionOpen`, before winPath mapping:

```js
if (action === 'terminal') {
  await claudeRestoreOne({ id });
  scheduleHaRefresh();
  return;
}
```

Remove `claudeProjects` block from `config.example.yml`; leave a one-line comment:

```yaml
# Project hotkeys + WT profiles: claudeWt.projects in windows11-manager.config.js
```

Keep `sshApp` for nothing Claude-session-related; explorer/cursor unchanged. `buildOpenCommands` terminal branch may remain for other callers/tests but session-open must not use it.

- [ ] **Step 4: Run tests**

Run: `node --test test/tauri-config.test.js test/claude-project-helpers.test.js test/session-open-helpers.test.js`

- [ ] **Step 5: Commit + deploy-fast**

```bash
git add src/modules/windows.js config.example.yml test/tauri-config.test.js
git commit -m "feat(claude-wt): load projects from manager; Terminal reopens via restore"
npm run deploy-fast
```

Note: hotkeys still from old yaml until Task 4 ships a rebuild — after Task 3 alone, if yaml projects removed from live config before Rust change, project hotkeys break until Task 4+rebuild. **Do not remove live yaml `claudeProjects` until Task 4 is deployed** (Task 5).

---

### Task 4: Rust — load projects via ESM node dump

Working directory: `D:/projects/js/windows-mqtt`.

**Files:**
- Modify: `src-tauri/src/main.rs` (`parse_claude_projects`, `read_claude_projects`, setup registration, tests)

**Interfaces:**
- Consumes: `claudeWtProjects()` JSON from node.
- Produces: same hotkey registration; no yaml dependency.

- [ ] **Step 1: Failing tests**

Replace yaml-parse unit tests with tests for a pure JSON parser helper, e.g. `parse_claude_projects_json(s: &str) -> Vec<ClaudeProject>`:

```rust
#[test]
fn claude_projects_json_parses_entries() {
    let projects = parse_claude_projects_json(
        r#"[{"name":"home","cwd":"/p/home","hotkey":"Ctrl+F11","profile":"home"}]"#,
    );
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].name, "home");
    assert_eq!(projects[0].hotkey, "Ctrl+F11");
}

#[test]
fn claude_projects_json_skips_incomplete() {
    let projects = parse_claude_projects_json(
        r#"[{"name":"x"},{"name":"ok","cwd":"/p","hotkey":"Ctrl+F12"}]"#,
    );
    assert_eq!(projects.len(), 1);
}
```

Remove tests that call `parse_claude_projects` on yaml.

- [ ] **Step 2: Run — expect FAIL**

Run: `cd src-tauri && cargo test claude_projects`

- [ ] **Step 3: Implement**

```rust
fn parse_claude_projects_json(content: &str) -> Vec<ClaudeProject> {
    let value: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let Some(list) = value.as_array() else { return Vec::new() };
    let mut out = Vec::new();
    for item in list {
        let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let cwd = item.get("cwd").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let hotkey = item.get("hotkey").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if name.is_empty() || cwd.is_empty() || hotkey.is_empty() {
            continue;
        }
        out.push(ClaudeProject { name, cwd, hotkey });
    }
    out
}

fn read_claude_projects_from_manager(app_root: &PathBuf) -> Vec<ClaudeProject> {
    let output = std::process::Command::new("node")
        .args([
            "--input-type=module",
            "-e",
            "import m from 'windows11-manager'; process.stdout.write(JSON.stringify(m.claudeWtProjects()))",
        ])
        .current_dir(app_root)
        .output();
    match output {
        Ok(o) if o.status.success() => {
            parse_claude_projects_json(&String::from_utf8_lossy(&o.stdout))
        }
        _ => Vec::new(),
    }
}
```

In setup, replace `read_claude_projects(&resolve_config_path(...))` with `read_claude_projects_from_manager(root)`.

Delete `parse_claude_projects` / `read_claude_projects` yaml helpers.

- [ ] **Step 4: Run tests**

Run: `cd src-tauri && cargo test claude_projects`

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/main.rs
git commit -m "feat(claude-wt): register project hotkeys from manager JS API"
```

**Deploy:** Rust change requires `npm run deploy-local` (or equivalent full rebuild) — not `deploy-fast`. Run it at end of this task or note for human if rebuild is long; do not leave hotkeys on yaml.

---

### Task 5: Live personal config (manual, no repo commit)

**Files:**
- `C:/Users/popstas/AppData/Roaming/windows-mqtt/windows11-manager.config.js`
- `C:/Users/popstas/AppData/Roaming/windows-mqtt/config.yml`

- [ ] Move `claudeProjects` entries into `claudeWt.projects` (name, cwd, hotkey, profile).
- [ ] Remove `claudeProjects` from `config.yml`.
- [ ] Confirm `claudeWt.profile: 'popstas'` and no baked `-p` in launch args.
- [ ] Rebuild/restart app so Rust picks up projects (`deploy-local` if Task 4 not yet installed).
- [ ] Smoke: Ctrl+F12 / snapshot restore ExpertizeMe → WT `-p ExpertizeMe`; unknown cwd → `-p popstas`; picker Terminal on a closed session → restore path.

---

## Spec coverage check

| Spec requirement | Task |
|---|---|
| `claudeWt.projects` + defaults | 1 |
| `profileForCwd` / `claudeWtProjects` | 1 |
| `planWtLaunch` shared builder | 2 |
| restore/snapshot per-cwd profile | 2 |
| openClaudeProject via shared path | 2 |
| mqtt node uses manager projects | 3 |
| picker Terminal → restore | 3 |
| remove yaml `claudeProjects` from example | 3 |
| Rust ESM dump + drop yaml parse | 4 |
| Live config migration | 5 |
| No launch+launchNew merge | (out of scope) |
| explorer/cursor untouched | (out of scope) |
