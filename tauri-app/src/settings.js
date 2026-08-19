const { invoke } = window.__TAURI__.core;

const form = document.getElementById('settings-form');
const status = document.getElementById('status');

// tileZones живёт не в tauri-plugin-store, а в YAML-конфиге node-части, и
// читается/пишется отдельными вызовами (get_tile_zones/save_tile_zones), не
// через get_settings/save_settings. Если чтение при открытии окна не
// удалось, поле остаётся пустым — и безусловный сабмит в этот момент отправил
// бы в конфиг пустой tileZones: [], стерев то, что там реально есть. Флаг
// запрещает такое сохранение, пока окно не откроют заново.
let tileZonesLoadFailed = false;

// Поля вкладки Claude, что живут в том же YAML-конфиге (claudeWt.* и слоты
// панели из homeassistant.*): читаются get_claude_config, пишутся
// save_claude_config. Флаг — та же страховка, что у зон рядом, и по той же
// причине: не прочитанное при открытии окна поле не должно уехать в конфиг
// пустым. Загруженные значения запоминаются целиком, потому что сохраняются
// только изменённые — нетронутая форма не дописывает в конфиг ключей, которых
// там не было (см. collectClaudeConfigPatch).
let claudeConfigLoadFailed = false;
let claudeConfigLoaded = {};

/** Узлы полей конфига: имя ключа и тип стоят на самом узле (data-cfg*). */
function claudeConfigNodes() {
  return document.querySelectorAll('[data-cfg]');
}

/** Умолчание поля, записанное в разметке, в виде значения своего типа. */
function fieldDefault(node) {
  const raw = node.dataset.cfgDefault ?? '';
  if (node.dataset.cfgType === 'boolean') return raw === 'true';
  if (node.dataset.cfgType === 'number') return Number(raw);
  return raw;
}

/**
 * Значение поля формы. Пустой текст — `null`, «не задано»: плейсхолдер поля
 * показывает умолчание, и пустота значит именно его, а не пустую строку.
 *
 * Целое приводится к числу, всё остальное остаётся строкой нарочно: `Number()`
 * от «12abc» дал бы NaN, а тот уехал бы в JSON как `null` и молча стёр бы ключ.
 * Пусть негодную строку отвергнет node — с именем поля и причиной в статусе.
 */
function fieldValue(node) {
  if (node.dataset.cfgType === 'boolean') return node.checked;
  const text = node.value.trim();
  if (!text) return null;
  if (node.dataset.cfgType === 'number' && /^-?\d+$/.test(text)) return Number(text);
  return text;
}

function fillClaudeConfig(values) {
  claudeConfigLoaded = values;
  for (const node of claudeConfigNodes()) {
    const value = values[node.dataset.cfg] ?? null;
    if (node.dataset.cfgType === 'boolean') {
      // Галочке «не задано» изобразить нечем — показывается умолчание. То, что
      // ключа в конфиге нет, помнит claudeConfigLoaded, и сохранение на этом
      // и держится.
      node.checked = value === null ? fieldDefault(node) : value === true;
    } else {
      node.value = value === null ? '' : String(value);
    }
  }
}

/**
 * Только изменённые поля: `{ 'claudeWt.interval': 2000 }`, где `null` значит
 * «убрать ключ, вернуть умолчание».
 *
 * Сравниваются ДЕЙСТВУЮЩИЕ значения (незаданное = умолчание), а не то, что
 * видно в поле. Иначе выходило бы одно из двух: либо пустое поле незаданного
 * ключа читалось бы как изменение и записывало умолчание в конфиг, либо
 * записанный в конфиг руками ключ со значением умолчания стирался бы при
 * первом же сохранении, которого никто не просил.
 *
 * Возврат к умолчанию записывается удалением ключа, а не его значением: так
 * поле продолжит следовать за умолчанием, если то изменится в коде.
 */
function collectClaudeConfigPatch() {
  const patch = {};
  for (const node of claudeConfigNodes()) {
    const name = node.dataset.cfg;
    const dflt = fieldDefault(node);
    const loaded = claudeConfigLoaded[name] ?? null;
    const current = fieldValue(node);
    const wasEffective = loaded === null ? dflt : loaded;
    const nowEffective = current === null ? dflt : current;
    if (nowEffective === wasEffective) continue;
    patch[name] = nowEffective === dflt ? null : nowEffective;
  }
  return patch;
}

/**
 * Предупреждение о неудавшемся чтении — в самом окне, а не только в консоли:
 * человек должен видеть, почему поле пустое и почему сабмит его не тронет.
 * Строк может быть две (зоны и поля конфига читаются независимо), поэтому они
 * копятся, а не затирают друг друга.
 */
function showLoadWarning(text) {
  status.style.color = '#f9e2af';
  status.textContent = status.textContent ? `${status.textContent} · ${text}` : text;
}

async function loadSettings() {
  // Три независимых чтения — параллельно, а не одно за другим внутри общего
  // try: последовательный await get_tile_zones() между заполнением полей
  // держал остальную форму (включая mqtt_*) пустой на время своего запроса, и
  // сабмит в этот момент сохранил бы пустые настройки MQTT.
  const [settingsResult, tileZonesResult, versionResult, claudeConfigResult] = await Promise.allSettled([
    invoke('get_settings'),
    invoke('get_tile_zones'),
    invoke('get_app_version'),
    invoke('get_claude_config'),
  ]);

  if (settingsResult.status === 'fulfilled') {
    const settings = settingsResult.value;
    document.getElementById('project_path').value = settings.project_path;
    document.getElementById('autoplacer_interval').value = settings.autoplacer_interval;
    document.getElementById('no_move_desktop').checked = settings.no_move_desktop;
    document.getElementById('no_follow_desktop').checked = settings.no_follow_desktop;
    document.getElementById('run_on_startup').checked = settings.run_on_startup;
    document.getElementById('show_notifications').checked = settings.show_notifications;
    document.getElementById('restore_on_start').checked = settings.restore_on_start;
    document.getElementById('store_before_exit').checked = settings.store_before_exit;
    document.getElementById('claude_wt_enabled').checked = settings.claude_wt_enabled;
    document.getElementById('place_hotkey').value = settings.place_hotkey ?? '';
    document.getElementById('store_interval').value = settings.store_interval;
    document.getElementById('store_match_list').value = (settings.store_match_list || []).join('\n');
    document.getElementById('timeout_before_open').value = settings.timeout_before_open;
    document.getElementById('update_check_interval').value = settings.update_check_interval || 'launch';
    document.getElementById('mqtt_enabled').checked = settings.mqtt_enabled;
    document.getElementById('mqtt_host').value = settings.mqtt_host;
    document.getElementById('mqtt_port').value = settings.mqtt_port;
    document.getElementById('mqtt_username').value = settings.mqtt_username;
    document.getElementById('mqtt_password').value = settings.mqtt_password;
    document.getElementById('mqtt_topic').value = settings.mqtt_topic;
  } else {
    console.error('Failed to load settings:', settingsResult.reason);
  }

  if (tileZonesResult.status === 'fulfilled') {
    tileZonesLoadFailed = false;
    document.getElementById('tile_zones').value = tileZonesResult.value;
  } else {
    tileZonesLoadFailed = true;
    console.error('Failed to load tile zones:', tileZonesResult.reason);
    // Не в console.error и молчок: человек должен увидеть в самом окне,
    // почему поле пустое и почему сабмит его не тронет.
    showLoadWarning(`Tile zones failed to load (${tileZonesResult.reason}) — the field will not be saved until you reopen this window`);
  }

  if (claudeConfigResult.status === 'fulfilled') {
    try {
      // Разбор здесь, а не в Rust: список полей ведёт node, и лишний тип на
      // стороне трея пришлось бы держать с ним в согласии.
      fillClaudeConfig(JSON.parse(claudeConfigResult.value));
      claudeConfigLoadFailed = false;
    } catch (e) {
      claudeConfigLoadFailed = true;
      console.error('Failed to parse claude config:', e);
      showLoadWarning(`Claude config failed to parse (${e}) — those fields will not be saved until you reopen this window`);
    }
  } else {
    claudeConfigLoadFailed = true;
    console.error('Failed to load claude config:', claudeConfigResult.reason);
    showLoadWarning(`Claude config failed to load (${claudeConfigResult.reason}) — those fields will not be saved until you reopen this window`);
  }

  if (versionResult.status === 'fulfilled') {
    // Та же строка, что у неактивного пункта меню трея (`version_info`):
    // формат считает Rust (version_item_label), здесь — только вывод.
    const el = document.getElementById('app-version');
    if (el) el.textContent = versionResult.value;
  } else {
    console.error('Failed to load version:', versionResult.reason);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const settings = {
    project_path: document.getElementById('project_path').value,
    autoplacer_interval: parseInt(document.getElementById('autoplacer_interval').value, 10) || 0,
    no_move_desktop: document.getElementById('no_move_desktop').checked,
    no_follow_desktop: document.getElementById('no_follow_desktop').checked,
    run_on_startup: document.getElementById('run_on_startup').checked,
    show_notifications: document.getElementById('show_notifications').checked,
    restore_on_start: document.getElementById('restore_on_start').checked,
    store_before_exit: document.getElementById('store_before_exit').checked,
    claude_wt_enabled: document.getElementById('claude_wt_enabled').checked,
    place_hotkey: document.getElementById('place_hotkey').value.trim(),
    store_interval: parseInt(document.getElementById('store_interval').value, 10) || 0,
    store_match_list: document.getElementById('store_match_list').value.split('\n').map(s => s.trim()).filter(Boolean),
    timeout_before_open: parseInt(document.getElementById('timeout_before_open').value, 10) || 5,
    update_check_interval: document.getElementById('update_check_interval').value,
    mqtt_enabled: document.getElementById('mqtt_enabled').checked,
    mqtt_host: document.getElementById('mqtt_host').value,
    mqtt_port: parseInt(document.getElementById('mqtt_port').value, 10) || 1883,
    mqtt_username: document.getElementById('mqtt_username').value,
    mqtt_password: document.getElementById('mqtt_password').value,
    mqtt_topic: document.getElementById('mqtt_topic').value,
  };

  const tileZonesText = document.getElementById('tile_zones').value;

  try {
    // Совпавшие хоткеи не блокируют сохранение (см. save_settings) — пустая
    // строка значит «без предупреждений».
    const warning = await invoke('save_settings', { settings });

    // tileZones — отдельное хранилище (YAML node-части), отдельный вызов.
    // Пропущено, если чтение при открытии окна не удалось: иначе это поле
    // ушло бы в конфиг пустым и стёрло бы то, что там реально есть (см.
    // tileZonesLoadFailed выше). Неразборчивую строку node не отбрасывает
    // молча, а отказывает с её номером и содержимым — это и есть текст
    // ошибки ниже, показанный в статусе окна, а не только в логе.
    let tileZonesError = '';
    if (tileZonesLoadFailed) {
      tileZonesError = 'not saved — the field did not load when the window opened, reopen settings';
    } else {
      try {
        await invoke('save_tile_zones', { text: tileZonesText });
      } catch (e) {
        tileZonesError = String(e);
      }
    }

    // Поля YAML-конфига вкладки Claude — третье независимое хранилище в этой
    // форме, со своим вызовом и своей неудачей. Отправляются только изменённые
    // (см. collectClaudeConfigPatch): пустой объект не тревожит конфиг вовсе.
    let claudeConfigError = '';
    if (claudeConfigLoadFailed) {
      claudeConfigError = 'not saved — the fields did not load when the window opened, reopen settings';
    } else {
      const patch = collectClaudeConfigPatch();
      if (Object.keys(patch).length) {
        try {
          await invoke('save_claude_config', { json: JSON.stringify(patch) });
          // Записанное становится новым исходным: иначе второй сабмит подряд
          // отправил бы те же правки ещё раз, а возврат поля к прежнему
          // значению не считался бы изменением вовсе.
          for (const [name, value] of Object.entries(patch)) claudeConfigLoaded[name] = value;
        } catch (e) {
          claudeConfigError = String(e);
        }
      }
    }

    // Предупреждение о хоткеях не должно потеряться за ошибкой зон (и
    // наоборот) — все независимы, и показывается каждое, что случилось.
    const messages = [];
    if (tileZonesError) messages.push('Tile zones: ' + tileZonesError);
    if (claudeConfigError) messages.push('Claude config: ' + claudeConfigError);
    if (warning) messages.push(warning);

    if (messages.length) {
      status.style.color = (tileZonesError || claudeConfigError) ? '#f38ba8' : '#f9e2af';
      status.textContent = messages.join(' · ');
      setTimeout(() => { status.textContent = ''; }, 8000);
    } else {
      status.style.color = '#a6e3a1';
      status.textContent = 'Saved!';
      setTimeout(() => { status.textContent = ''; }, 2000);
    }
  } catch (e) {
    status.textContent = 'Error: ' + e;
    status.style.color = '#f38ba8';
  }
});

// Вкладки. `data-tab` стоит и на кнопке, и на её странице, поэтому показ
// переключается одним обходом по обоим спискам разом.
const LOG_TAB = 'log';
const LOG_REFRESH_MS = 2000;
let logTimer = null;

function showTab(id) {
  for (const node of document.querySelectorAll('[data-tab]')) {
    node.classList.toggle('active', node.dataset.tab === id);
  }
  // Лог перечитывается, только пока его вкладка открыта: файл читается с
  // диска, а сидят в настройках обычно не на нём.
  clearInterval(logTimer);
  logTimer = null;
  if (id === LOG_TAB) {
    refreshLog();
    logTimer = setInterval(refreshLog, LOG_REFRESH_MS);
  }
}

async function refreshLog() {
  const view = document.getElementById('log-view');
  if (!view) return;
  let text;
  try {
    text = await invoke('read_log');
  } catch (e) {
    text = String(e);
  }
  if (!text) text = 'nothing logged yet';
  // Молчаливый такт не трогает узел вовсе: перезапись того же текста сбивала
  // бы выделение под курсором каждые две секунды — а лог читают, выделяя
  // строки. Она же сбрасывала бы прокрутку, отнятую у нижнего края.
  if (text === view.textContent) return;
  // Прокрутка догоняет низ, только если она и была внизу: человека, ушедшего
  // читать выше, новая запись не должна утаскивать обратно.
  const atBottom = view.scrollHeight - view.scrollTop - view.clientHeight < 4;
  view.textContent = text;
  if (atBottom) view.scrollTop = view.scrollHeight;
}

document.getElementById('tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) showTab(tab.dataset.tab);
});

loadSettings();
