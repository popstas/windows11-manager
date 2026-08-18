const { invoke } = window.__TAURI__.core;

const form = document.getElementById('settings-form');
const status = document.getElementById('status');

async function loadSettings() {
  try {
    const settings = await invoke('get_settings');
    document.getElementById('project_path').value = settings.project_path;
    document.getElementById('autoplacer_interval').value = settings.autoplacer_interval;
    document.getElementById('run_on_startup').checked = settings.run_on_startup;
    document.getElementById('show_notifications').checked = settings.show_notifications;
    document.getElementById('restore_on_start').checked = settings.restore_on_start;
    document.getElementById('store_before_exit').checked = settings.store_before_exit;
    document.getElementById('claude_wt_enabled').checked = settings.claude_wt_enabled;
    document.getElementById('place_hotkey').value = settings.place_hotkey ?? '';
    document.getElementById('tile_hotkey').value = settings.tile_hotkey ?? '';
    document.getElementById('cascade_hotkey').value = settings.cascade_hotkey ?? '';
    document.getElementById('store_interval').value = settings.store_interval;
    // tileZones живёт не в этом хранилище, а в YAML-конфиге node-части —
    // читается отдельным вызовом (см. save_tile_zones ниже про запись).
    try {
      document.getElementById('tile_zones').value = await invoke('get_tile_zones');
    } catch (e) {
      console.error('Failed to load tile zones:', e);
    }
    document.getElementById('store_match_list').value = (settings.store_match_list || []).join('\n');
    document.getElementById('timeout_before_open').value = settings.timeout_before_open;
    document.getElementById('update_check_interval').value = settings.update_check_interval || 'launch';
    document.getElementById('mqtt_enabled').checked = settings.mqtt_enabled;
    document.getElementById('mqtt_host').value = settings.mqtt_host;
    document.getElementById('mqtt_port').value = settings.mqtt_port;
    document.getElementById('mqtt_username').value = settings.mqtt_username;
    document.getElementById('mqtt_password').value = settings.mqtt_password;
    document.getElementById('mqtt_topic').value = settings.mqtt_topic;
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
  try {
    // Та же строка, что у неактивного пункта меню трея (`version_info`):
    // формат считает Rust (version_item_label), здесь — только вывод.
    const version = await invoke('get_app_version');
    const el = document.getElementById('app-version');
    if (el) el.textContent = version;
  } catch (e) {
    console.error('Failed to load version:', e);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const settings = {
    project_path: document.getElementById('project_path').value,
    autoplacer_interval: parseInt(document.getElementById('autoplacer_interval').value, 10) || 0,
    run_on_startup: document.getElementById('run_on_startup').checked,
    show_notifications: document.getElementById('show_notifications').checked,
    restore_on_start: document.getElementById('restore_on_start').checked,
    store_before_exit: document.getElementById('store_before_exit').checked,
    claude_wt_enabled: document.getElementById('claude_wt_enabled').checked,
    place_hotkey: document.getElementById('place_hotkey').value.trim(),
    tile_hotkey: document.getElementById('tile_hotkey').value.trim(),
    cascade_hotkey: document.getElementById('cascade_hotkey').value.trim(),
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

    // tileZones живёт не в этом хранилище, а в YAML-конфиге node-части, и
    // сохраняется отдельным вызовом. Неразборчивую строку node не отбрасывает
    // молча, а отказывает с её номером и содержимым — это и есть текст ошибки
    // ниже, показанный в статусе окна, а не только в логе.
    let tileZonesError = '';
    try {
      await invoke('save_tile_zones', { text: tileZonesText });
    } catch (e) {
      tileZonesError = String(e);
    }

    if (tileZonesError) {
      status.style.color = '#f38ba8';
      status.textContent = 'Tile zones: ' + tileZonesError;
    } else if (warning) {
      status.style.color = '#f9e2af';
      status.textContent = warning;
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

loadSettings();
