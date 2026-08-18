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

async function loadSettings() {
  // Три независимых чтения — параллельно, а не одно за другим внутри общего
  // try: последовательный await get_tile_zones() между заполнением полей
  // держал остальную форму (включая mqtt_*) пустой на время своего запроса, и
  // сабмит в этот момент сохранил бы пустые настройки MQTT.
  const [settingsResult, tileZonesResult, versionResult] = await Promise.allSettled([
    invoke('get_settings'),
    invoke('get_tile_zones'),
    invoke('get_app_version'),
  ]);

  if (settingsResult.status === 'fulfilled') {
    const settings = settingsResult.value;
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
    status.style.color = '#f9e2af';
    status.textContent = `Tile zones не загрузились (${tileZonesResult.reason}) — поле не будет сохранено, пока окно не откроют заново`;
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

    // tileZones — отдельное хранилище (YAML node-части), отдельный вызов.
    // Пропущено, если чтение при открытии окна не удалось: иначе это поле
    // ушло бы в конфиг пустым и стёрло бы то, что там реально есть (см.
    // tileZonesLoadFailed выше). Неразборчивую строку node не отбрасывает
    // молча, а отказывает с её номером и содержимым — это и есть текст
    // ошибки ниже, показанный в статусе окна, а не только в логе.
    let tileZonesError = '';
    if (tileZonesLoadFailed) {
      tileZonesError = 'не сохранены — поле не подтянулось при открытии окна, откройте настройки заново';
    } else {
      try {
        await invoke('save_tile_zones', { text: tileZonesText });
      } catch (e) {
        tileZonesError = String(e);
      }
    }

    // Предупреждение о хоткеях не должно потеряться за ошибкой зон (и
    // наоборот) — оба независимы, оба показываются, если оба есть.
    const messages = [];
    if (tileZonesError) messages.push('Tile zones: ' + tileZonesError);
    if (warning) messages.push(warning);

    if (messages.length) {
      status.style.color = tileZonesError ? '#f38ba8' : '#f9e2af';
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

loadSettings();
