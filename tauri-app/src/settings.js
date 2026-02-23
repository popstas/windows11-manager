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
    document.getElementById('mqtt_enabled').checked = settings.mqtt_enabled;
    document.getElementById('mqtt_host').value = settings.mqtt_host;
    document.getElementById('mqtt_port').value = settings.mqtt_port;
    document.getElementById('mqtt_username').value = settings.mqtt_username;
    document.getElementById('mqtt_password').value = settings.mqtt_password;
    document.getElementById('mqtt_topic').value = settings.mqtt_topic;
    document.getElementById('ws_port').value = settings.ws_port;
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const settings = {
    project_path: document.getElementById('project_path').value,
    autoplacer_interval: parseInt(document.getElementById('autoplacer_interval').value, 10) || 0,
    run_on_startup: document.getElementById('run_on_startup').checked,
    show_notifications: document.getElementById('show_notifications').checked,
    mqtt_enabled: document.getElementById('mqtt_enabled').checked,
    mqtt_host: document.getElementById('mqtt_host').value,
    mqtt_port: parseInt(document.getElementById('mqtt_port').value, 10) || 1883,
    mqtt_username: document.getElementById('mqtt_username').value,
    mqtt_password: document.getElementById('mqtt_password').value,
    mqtt_topic: document.getElementById('mqtt_topic').value,
    ws_port: parseInt(document.getElementById('ws_port').value, 10) || 9721,
  };

  try {
    await invoke('save_settings', { settings });
    status.style.color = '#a6e3a1';
    status.textContent = 'Saved!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  } catch (e) {
    status.textContent = 'Error: ' + e;
    status.style.color = '#f38ba8';
  }
});

loadSettings();
