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
  };

  try {
    await invoke('save_settings', { settings });
    status.textContent = 'Saved!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  } catch (e) {
    status.textContent = 'Error: ' + e;
    status.style.color = '#f38ba8';
  }
});

loadSettings();
