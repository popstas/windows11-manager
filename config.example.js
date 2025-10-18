// you can define popular placement templates
const mon1RightHalf = {
  fancyZones: {
    monitor: 1,
    position: 2,
  },
  /* x: 'mon1.right',
  y: 'mon1.top',
  width: 'mon1.halfWidth',
  height: 'mon1.height', */
};

const windows = [
  // place at desktop and position by window title
  {...mon1RightHalf, ...{
    titleMatch: '^home - ',
    desktop: 1,
  }},

  // place desktop
  {
    titleMatch: 'npm',
    desktop: 1,
  },

  // place all "gmail" windows (by title) except thunderbird (by path)
  {
    titleMatch: 'gmail',
    exclude: {
      pathMatch: 'thunderbird',
    },
    desktop: 2,
  },

  // place and pin window, not apply other rules (single mode)
  {
    titleMatch: 'Mozilla Thunderbird$',
    fancyZones: {
      monitor: 2,
      position: 4,
    },
    pin: true,
    single: true,
  },

  // set window coordinates by path
  {
    pathMatch: 'putty.exe',
    x: 1675,
    y: 575,
  },
];

const fancyZones = {
  enabled: true,
  path: 'C:/Users/popstas/AppData/Local/Microsoft/PowerToys/FancyZones', // TODO: detect
};

const monitorsGaps = {
  // Example: reserve 10px at the bottom of monitor 2 for the taskbar
  2: { position: 'bottom', gap: 10 },
};

const wallpapers = {
  0: 'd:/images/wallpapers/desktops/1.png',
  1: 'd:/images/wallpapers/desktops/2.png',
  2: 'd:/images/wallpapers/desktops/3.png',
};

module.exports = {
  debug: false,
  windows,
  fancyZones,
  monitorsGaps,
  wallpapers,

  virtualDesktopPath: __dirname +'/VirtualDesktop11.exe',
  store: {
    path: './data/windows-store.json',

    // apps which can be stored
    matchList: [
      'browser.exe',
      'chrome.exe',
      'code.exe',
      'firefox.exe',
      'scalc.exe', // libre office
      'thunderbird.exe',
      'toggldesktop.exe',
      'slack.exe',
      'telegram.exe',
      'whatsapp.exe',
    ],
  },

  // backup positions for FancyZones
  positionsMap: [
    {
      from: { monitor: 1, position: 9 },
      to: { monitor: 1, position: 3 },
    },
    {
      from: { monitor: 3, position: 1 },
      to: { monitor: 2, position: 1 },
    },
    {
      from: { monitor: 3, position: 2 },
      to: { monitor: 2, position: 2 },
    },
    {
      from: { monitor: 3, position: 3 },
      to: { monitor: 2, position: 3 },
    },
  ],



  // deprecated config options
  panelWidth: 60,
  panelHeight: 40,
  monitors: { // часто слетает
    1: 0,
    2: 1,
    3: 2,
  },
  monitorsSize: {
    // name is optional, force pin monitor to it's index
    1: { width: 3440, height: 1440, name: 'IVM7613' },
    2: { width: 1440, height: 2560, name: 'DPL0000' },
    3: { width: 2560, height: 1080, name: 'GSM76FA' },
  },
  presets: [
    {
      name: 'home',
      monitors: {
        1: { width: 3440, height: 1440 },
        2: { width: 1440, height: 2560 },
        3: { width: 2560, height: 1080 },
      },
    },
    {
      name: 'office',
      monitors: {
        1: { width: 1920, height: 1080 },
        2: { width: 1920, height: 1080 },
      },
    },
  ],
}