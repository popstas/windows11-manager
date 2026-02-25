// Home

const homeMon1LeftSmall = {
  desktop: 1,
  width: 700,
  height: 480,
  x: 0,
  y: 0,
};

const homeMon3_1 = {
  desktop: 1,
  fancyZones: {
    monitor: 3,
    position: 1,
  },
};

const mon1_rightHalf = {
  fancyZones: {
    monitor: 1,
    position: 9,
  },
  /* x: 'mon1.right',
  y: 'mon1.top',
  width: 'mon1.halfWidth',
  height: 'mon1.height', */
};

const mon1RightThird = {
  fancyZones: {
    monitor: 1,
    position: 3,
  },
}

const mon1OBSZone = {
  fancyZones: {
    monitor: 1,
    position: 10,
  },
};

const homeMon1RightHalf = {
  desktop: 1,
  fancyZones: {
    monitor: 1,
    position: 9,
  },
}
const homeMon1RightThird = { ...mon1RightThird, ...{
  desktop: 1,
}}

const fmiMon1RightThird = { ...mon1RightThird, ...{
  desktop: 2,
}}




const homeWindows = [
  // browser
  /* {...homeMon1RightHalf, ...{
    titleMatch: '^home - ',
  }}, */
  /* {...homeMon1RightHalf, ...{
    titleMatch: 'Станислав Попов.*Яндекс.Браузер',
  }}, */
  {...homeMon1RightHalf, ...{
    titleMatch: 'Таблица активности',
  }},
  {...homeMon1RightHalf, ...{
    titleMatch: 'группа home',
  }},
  {...homeMon1RightHalf, ...{
    titleMatch: 'группа Thai',
  }},
  {...homeMon1RightHalf, ...{
    titleMatch: 'Node-RED :',
  }},
  /* {...homeMon1LeftSmall, ...{
    titleMatch: '^Popstas',
  }}, */
  {...mon1OBSZone, ...{
    desktop: 1,
    titleMatch: 'Курсы английского',
  }},
  {...mon1OBSZone, ...{
    desktop: 1,
    titleMatch: 'Wall Street English',
  }},
  {...mon1OBSZone, ...{
    desktop: 1,
    titleMatch: '- Anki',
  }},

  {
    titleMatch: 'npm',
    desktop: 1,
  },

  // projects
  {...homeMon1RightThird, ...{
    titleMatch: '^blog.popstas.ru ',
  }},
  {...homeMon1RightThird, ...{
    titleMatch: 'windows-mqtt ',
  }},
  {...homeMon1RightThird, ...{
    titleMatch: 'toggl-calendar',
  }},
  {...homeMon1RightThird, ...{
    titleMatch: 'mindwave-web',
  }},
  {...homeMon1RightThird, ...{
    titleMatch: 'windows11-manager',
  }},
  {...homeMon1RightThird, ...{
    titleMatch: 'test.home.popstas.ru',
  }},
  {...homeMon1RightThird, ...{
    titleMatch: 'yandex-dialogs-',
  }},
  {...homeMon1RightThird, ...{
    titleMatch: 'scad-models',
  }},

  {...mon1OBSZone, ...{
    titleMatch: '- mpv',
  }},

  // mon 2
  {
    titleMatch: '^OBS',
    fancyZones: {
      monitor: 2,
      position: 1,
    },
    pin: true,
    // single: true,
  },
  {
    titleMatch: '^Mind Tracker BCI',
    fancyZones: {
      monitor: 1,
      position: 3,
    },
    pin: true,
    // single: true,
  },
  {
    titleMatch: 'Trello.*popstas',
    desktop: 1,
    fancyZones: {
      monitor: 2,
      position: 4,
    },
  },
  {
    titleMatch: 'home - chrome',
    desktop: 1,
    fancyZones: {
      monitor: 2,
      position: 4,
    },
  },
  {
    titleMatch: 'Обзор - Home Assistant',
    fancyZones: {
      monitor: 2,
      position: 5,
    },
    desktop: 1,
  },
  {
    titleMatch: 'Node-RED Dashboard',
    fancyZones: {
      monitor: 2,
      position: 5,
    },
    desktop: 1,
  },
  {
    titleMatch: 'chords-viewer',
    fancyZones: {
      monitor: 2,
      position: 4,
    },
    desktop: 1,
  },
];






// 1MI

const fmiWindows = [
  // mon 1

  // browsers
  {
    titleMatch: 'группа work 1',
    fancyZones: {
      monitor: 1,
      position: 1,
    },
    desktop: 2,
  },
  {
    titleMatch: 'группа work 2',
    fancyZones: {
      monitor: 1,
      position: 2,
    },
    desktop: 2,
  },
  {
    titleMatch: 'группа work 3',
    fancyZones: {
      monitor: 1,
      position: 3,
    },
    desktop: 2,
  },

  // projects
  {
    titleMatch: 'liveinternet-positions',
    desktop: 2,
  },
  {
    titleMatch: 'gsheet2json',
    desktop: 2,
  },
  {
    titleMatch: 'Colaboratory',
    desktop: 2,
  },
  {
    titleMatch: 'smi-parser ',
    desktop: 2,
  },
  {
    titleMatch: 'telegram-planfix-bot',
    desktop: 2,
  },
  {...fmiMon1RightThird, ...{
    titleMatch: '^google-contacts-tools',
  }},
  {...fmiMon1RightThird, ...{
    titleMatch: '^yandex-accounts',
  }},
  {...fmiMon1RightThird, ...{
    titleMatch: '^front_site',
  }},
  {...fmiMon1RightThird, ...{
    titleMatch: '^front_admin',
  }},
  {...fmiMon1RightThird, ...{
    titleMatch: '^api',
  }},
  {...mon1RightThird, ...{
    titleMatch: '^ansible-server',
  }},
  {...fmiMon1RightThird, ...{
    titleMatch: '^ansible-server-config',
  }},
  {...fmiMon1RightThird, ...{
    titleMatch: '^1mi-v2',
  }},
  {...fmiMon1RightThird, ...{
    titleMatch: '^media-parser',
  }},
  {...fmiMon1RightThird, ...{
    titleMatch: '^account-create',
    single: true,
  }},
  {
    titleMatch: 'ExpertizeMe - Obsidian',
    desktop: 2,
  },

  // other
  {
    titleMatch: 'Сотрудники 1M',
    desktop: 2,
  },
  {
    titleMatch: '^ФМИ ',
    desktop: 2,
  },
  {
    titleMatch: 'ФМИ',
    desktop: 2,
  },
  {
    titleMatch: '1mediainvest',
    desktop: 2,
  },
  {
    titleMatch: 'Uramedia',
    desktop: 2,
  },
  {
    titleMatch: 'Медиа - админка',
    desktop: 2,
  },
  {
    titleMatch: '1Mi',
    desktop: 2,
  },
  {
    titleMatch: 'ExpertizeMe - ',
    desktop: 2,
  },
  {
    titleMatch: 'ExpertizeMe_english',
    desktop: 2,
  },
  {
    titleMatch: 'fma.su',
    exclude: {
      pathMatch: 'thunderbird',
    },
    desktop: 2,
  },

  // people
  {
    titleMatch: 'Олеся Вялая',
    desktop: 2,
  },
  {
    titleMatch: 'Денис Объедкин',
    desktop: 2,
  },
];





// Pinned

const pinnedWindows = [
  // mon 2
  /* {
    titleMatch: 'Toggl Track',
    fancyZones: {
      monitor: 2,
      position: 2,
    },
    pin: true,
  }, */
  {
    titleMatch: 'Mozilla Thunderbird( Beta)?$',
    fancyZones: {
      monitor: 2,
      position: 4,
    },
    pin: true,
    single: true,
    viasite: {
      pin: false,
      height: 'mon2.height',
    }
  },
  {
    titleMatch: 'eM Client$',
    fancyZones: {
      monitor: 2,
      position: 4,
    },
    pin: true,
    single: true,
    viasite: {
      pin: false,
      height: 'mon2.height',
    }
  },

  // mon 3
  {
    titleMatch: 'WhatsApp$',
    fancyZones: {
      monitor: 3,
      position: 2,
    },
    pin: true,
    viasite: {
      pin: false,
    }
  },
  {
    titleMatch: 'WhatsApp Web$', // chrome
    fancyZones: {
      monitor: 3,
      position: 2,
    },
    pin: true,
    viasite: {
      pin: false,
    }
  },
  {
    titleMatch: 'Outline$',
    fancyZones: {
      monitor: 3,
      position: 6,
    },
    pin: true,
    single: true,
    viasite: {
      pin: false,
    }
  },
  {
    titleMatch: 'AmneziaVPN$',
    fancyZones: {
      monitor: 3,
      position: 6,
    },
    pin: true,
    single: true,
  },
  {
    titleMatch: ' – \\(',
    pathMatch: 'Telegram.exe',
    fancyZones: {
      monitor: 3,
      position: 4,
    },
    pin: true,
    single: true,
    viasite: {
      pin: false,
    }
  },
  {
    titleMatch: 'Telegram$',
    fancyZones: {
      monitor: 3,
      position: 4,
    },
    pin: true,
    viasite: {
      pin: false,
    }
  },

  // mon 4
  {
    titleMatch: 'группа Grafana',
    fancyZones: {
      // monitor: 4,
      // position: 3,
      monitor: 3,
      position: 2,
    },
    pin: true,
    viasite: {
      pin: false,
    }
  },
  /* {
    titleMatch: 'System - Dashboards',
    fancyZones: {
      monitor: 4,
      position: 3,
    },
    pin: true,
    viasite: {
      pin: false,
    }
  },
  {
    titleMatch: 'System GPT',
    fancyZones: {
      monitor: 4,
      position: 3,
    },
    pin: true,
    viasite: {
      pin: false,
    }
  },
  {
    titleMatch: 'Main Daily',
    fancyZones: {
      monitor: 4,
      position: 3,
    },
    pin: true,
    viasite: {
      pin: false,
    }
  }, */
  {
    // titleMatch: 'Toggl Track$',
    pathMatch: 'TogglTrack.exe',
    fancyZones: {
      // monitor: 4,
      monitor: 3,
      position: 5,
    },
    single: true,
    pin: true,
  },
];





// Fixed position windows
const fixedPositionWindows = [
  /* {
    // titleMatch: 'popstas@popstas-server',
    // pathMatch: 'putty.exe',
    pathMatch: 'WindowsTerminal.exe',
    exclude: {
      titleMatch: 'ansible-server',
    },
    x: 1675,
    y: 575,
    // viasite: {
      // x: 700,
      // y: 300,
    // },
    onlyOnOpen: true,
  }, */
  {
    pathMatch: 'firefox.exe',
    pin: true,
  },
  {
    titleMatch: 'KeeWeb',
    x: 1675,
    y: 280,
    width: 1400,
    height: 800,
  },
  {
    titleMatch: 'Яндекс.Музыка',
    x: 'mon2.left',
    y: 'mon2.bottom',
    width: 'mon2.width',
    height: 700,
  },
  {
    titleMatch: 'Управление дисками',
    fancyZones: { monitor: 1, position: 2 },
  },
  {
    titleMatch: 'Disk Management',
    fancyZones: { monitor: 1, position: 2 },
  },
  {
    titleMatch: 'Диспетчер устройств',
    fancyZones: { monitor: 1, position: 3 },
  },
  {
    titleMatch: 'Device Manager',
    fancyZones: { monitor: 1, position: 3 },
  },
  /* {
    titleMatch: 'telegram-chatgpt-bot',
    fancyZones: { monitor: 1, position: 3 },
  }, */
];

const fancyZones = {
  enabled: true,
  path: 'C:/Users/popstas/AppData/Local/Microsoft/PowerToys/FancyZones',
};

const wallpapers = {
  1: 'd:/images/wallpapers/desktops/1.png',
  0: 'd:/images/wallpapers/desktops/2.png',
  2: 'd:/images/wallpapers/desktops/3.png',
}














module.exports = {
  // debug: false,
  debug: true,
  windows: [
    ...fmiWindows,
    ...homeWindows,
    ...pinnedWindows,
    ...fixedPositionWindows,
  ],
  fancyZones,
  wallpapers,

  store: {
    path: 'd:/projects/js/windows-mqtt/data/windows-store.json',
    matchList: [
      'anki.exe',
      'browser.exe',
      'chrome.exe',
      'code.exe',
      // 'explorer.exe',
      // 'files.exe',
      'firefox.exe',
      'keeweb.exe',
      'obsidian.exe',
      // 'obs64.exe', // не работает, появляется ошибка поиска локализации
      // 'phpstorm64.exe',
      "pycharm64.exe",
      // 'rubymine64.exe',
      'webstorm64.exe',
      'scalc.exe', // libre office
      'thunderbird.exe',
      // 'toggldesktop.exe',
      // 'toggltrack.exe', // it autoruns self
      // 'slack.exe',
      'telegram.exe',
      'whatsapp.exe',
    ]
  },

  positionsMap: [ // backup positions for FancyZones
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
    4: 3,
    5: 4,
  },
  monitorsSize: {
    1: { width: 3440, height: 1440, name: 'IVM7613' },
    2: { width: 1440, height: 2560, name: 'DPL0000' },
    3: { width: 2560, height: 1080, name: 'GSM76FA' },
    4: { width: 1920, height: 1080, name: 'ROF1331' },
    5: { width: 2160, height: 1350, name: 'LNV060F' }, // lenovo
    // 4: { width: 3840, height: 2160, name: 'RTK1B1A' },
  },
  // not used
  presets: [
    {
      name: 'home',
      monitors: {
        1: { width: 3440, height: 1440 },
        2: { width: 1440, height: 2560 },
        3: { width: 2560, height: 1080 },
        4: { width: 1920, height: 1080 },
        4: { width: 2160, height: 1350 },
        // 4: { width: 3840, height: 2160 },
      }
    },
    {
      name: 'viasite',
      monitors: {
        1: { width: 1920, height: 1080 },
        2: { width: 1920, height: 1080 },
      }
    },
  ],
}