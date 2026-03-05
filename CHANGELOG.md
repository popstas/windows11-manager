## [0.3.5](https://github.com/popstas/windows11-manager/compare/v0.4.0...v0.3.5) (2026-02-23)


### Bug Fixes

* **tray:** Restart (Store) completes and reboots ([a81c23a](https://github.com/popstas/windows11-manager/commit/a81c23ac0064c8922747c8c52f58071e529eae9d))


### Features

* **tray:** add Restart with Store, Sleep, and Shutdown power menu items ([92b6a8d](https://github.com/popstas/windows11-manager/commit/92b6a8da7053c9b625d3e51fb83efc3540a90936))



# [0.4.0](https://github.com/popstas/windows11-manager/compare/v0.3.4...v0.4.0) (2026-02-23)


### Bug Fixes

* **dashboard:** prevent infinite loading hang ([d001615](https://github.com/popstas/windows11-manager/commit/d001615d532c845ad534c9418480ed289e53834d))
* resolve dashboard loading and double tray icon bugs ([8966e1b](https://github.com/popstas/windows11-manager/commit/8966e1bfd137099be4054f0039848425f18224a4))
* **tauri:** run MQTT and WS server on Tauri runtime ([1897e20](https://github.com/popstas/windows11-manager/commit/1897e20cd1014865bd1e80f531463e090ba4397d))


### Features

* add place command via CLI and HTTP ([7126e1f](https://github.com/popstas/windows11-manager/commit/7126e1f0b72f3cc08f4670c91d1f33e998a02bf3))
* **dashboard:** add main dashboard window opened on tray icon click ([af83414](https://github.com/popstas/windows11-manager/commit/af8341400b0432338478cc4d4266f959b6618e94))
* **mqtt:** add MQTT client for remote control ([2abe9c2](https://github.com/popstas/windows11-manager/commit/2abe9c26612fc32576e25e35270e448a0acbd740))
* **mqtt:** move MQTT to Rust with WS bridge ([3092d04](https://github.com/popstas/windows11-manager/commit/3092d042d279bfb525e6deb563fbd36585f8e12a))
* **tray:** keep app running in tray when windows are closed ([3b62097](https://github.com/popstas/windows11-manager/commit/3b62097f4cdcb7bf1f265381d0f04ce3924a9957))



## [2.0.0](https://github.com/popstas/windows11-manager/compare/windows11-manager-v1.1.0...windows11-manager-v2.0.0) (2026-03-05)


### ⚠ BREAKING CHANGES

* migrate codebase from CJS to ESM

### Features

* add config.monitorsOffset ([ff21f06](https://github.com/popstas/windows11-manager/commit/ff21f06678d0713abb29f271204703143a910062))
* Add monitor gap support for FancyZones ([#7](https://github.com/popstas/windows11-manager/issues/7)) ([79c1302](https://github.com/popstas/windows11-manager/commit/79c130243c09878fcb3e436d573d7faf7a8cbdf8))
* add place command via CLI and HTTP ([7126e1f](https://github.com/popstas/windows11-manager/commit/7126e1f0b72f3cc08f4670c91d1f33e998a02bf3))
* Add reloadConfigs function to dynamically reload configuration files ([15a491d](https://github.com/popstas/windows11-manager/commit/15a491d10d611cc886c62777d0c324e4922d2be6))
* bring window to top after place ([4758065](https://github.com/popstas/windows11-manager/commit/47580655cfe22f619200133a38eae2e660acd1ce))
* **ci:** add GitHub Actions release workflow and fix Windows build ([284d82b](https://github.com/popstas/windows11-manager/commit/284d82b3a2a47c287d91145a450ff5a551e2609b))
* **cli:** add -v/--verbose option to restore ([41e99d6](https://github.com/popstas/windows11-manager/commit/41e99d6eadb78c4aa54c972e640f05d3753d2f62))
* command line: place, store, restore, stats ([8b4b957](https://github.com/popstas/windows11-manager/commit/8b4b957d4d4085443d90cb347bfa5ceca038e744))
* **config:** support loading config from multiple locations ([ec986ba](https://github.com/popstas/windows11-manager/commit/ec986ba294969307d8ae211d8fe570f87c9a961e))
* **dashboard:** add app icons to stats table ([f701aee](https://github.com/popstas/windows11-manager/commit/f701aee95741a801ef036666908a3549aa1d6ad8))
* **dashboard:** add autorun checkboxes to stats ([3b27563](https://github.com/popstas/windows11-manager/commit/3b27563a208d189c167fc98d86ec0c652a98938b))
* **dashboard:** add main dashboard window opened on tray icon click ([af83414](https://github.com/popstas/windows11-manager/commit/af8341400b0432338478cc4d4266f959b6618e94))
* **dashboard:** add running apps panel ([ba3a65f](https://github.com/popstas/windows11-manager/commit/ba3a65f3d8531a97ff559249d2199881f97e5848))
* implement addFancyZoneHistory ([#5](https://github.com/popstas/windows11-manager/issues/5)) ([cf5e247](https://github.com/popstas/windows11-manager/commit/cf5e247d749dd1f0966920da17b9d35ed1e646e7))
* **mqtt:** add MQTT client for remote control ([2abe9c2](https://github.com/popstas/windows11-manager/commit/2abe9c26612fc32576e25e35270e448a0acbd740))
* **mqtt:** move MQTT to Rust with WS bridge ([3092d04](https://github.com/popstas/windows11-manager/commit/3092d042d279bfb525e6deb563fbd36585f8e12a))
* **openWindows:** support arguments for restore windows ([c05d998](https://github.com/popstas/windows11-manager/commit/c05d998ea8d5c5f443260e3f7ab8fcfb48625c85))
* pin monitor to num by name ([f8ff010](https://github.com/popstas/windows11-manager/commit/f8ff010e7c143d5bb9ae76e04ad380482ffbad8c))
* **placement:** add rule data to Place logs ([cd27c96](https://github.com/popstas/windows11-manager/commit/cd27c9655d349dd38a6114f28715468b90e2c5c6))
* **placement:** make place idempotent status visible ([24318ae](https://github.com/popstas/windows11-manager/commit/24318ae8ff150c0fa0b0534f7cf1ce67c2fce604))
* **placement:** route placement logs to verboseLog and add window count ([f143735](https://github.com/popstas/windows11-manager/commit/f143735ba61ef5f5dbbf750758979aec679bb308))
* **placement:** show summary in stdout ([03ea3ae](https://github.com/popstas/windows11-manager/commit/03ea3ae1e1c7d3c672895a6f7e49a53550a3813e))
* **placement:** show summary prominently ([c34dc4c](https://github.com/popstas/windows11-manager/commit/c34dc4cfc2104858ac09372f72eb3a60729216d9))
* **placement:** track skipped windows and remove noisy "Already" logs ([35459f8](https://github.com/popstas/windows11-manager/commit/35459f8ba7fcf35f9edaf2e18cee13322e6913e2))
* **place:** verbose output and placement history ([250f71f](https://github.com/popstas/windows11-manager/commit/250f71f61e366f689c0d7e51e402be28481f64fe))
* placeWindows, autoplace, setWallpapers, store/restore, fancyZones, stats, placeWindowOnOpen, focusWindow ([08b864c](https://github.com/popstas/windows11-manager/commit/08b864cf078d63c82e7e94d895247e27d47bf7d9))
* reload configs when FancyZones layout changes ([#6](https://github.com/popstas/windows11-manager/issues/6)) ([a979f48](https://github.com/popstas/windows11-manager/commit/a979f487ed979a72723829227f837d78c70d705c))
* rule.onlyOnOpen ([84d17d7](https://github.com/popstas/windows11-manager/commit/84d17d77c25616b58fbee0cd347f06d87cacc655))
* **tauri:** add file logging with fern ([36802cd](https://github.com/popstas/windows11-manager/commit/36802cd4989275b2f58020b46ee741af86f123a3))
* **tauri:** add missing tray menu items for feature parity with windows-mqtt ([b0058ac](https://github.com/popstas/windows11-manager/commit/b0058acbc1061896860a32abfb6f2e49e601a4e0))
* **tauri:** add restore-on-start, store-before-exit, and timeout-before-open settings ([e85472c](https://github.com/popstas/windows11-manager/commit/e85472c0801a191bb666ff4c88fb53f3bb5220a5))
* **tauri:** add tray app with Place Windows and Autoplacer ([65474c2](https://github.com/popstas/windows11-manager/commit/65474c21f8a26ce8b8dafcb6e5d4139ee58744b9))
* **tauri:** show app version in Settings window ([e059837](https://github.com/popstas/windows11-manager/commit/e0598371b4ce34e7f203e788e0b3dd5e6d37801c))
* **tray:** add GitHub release update checker ([f2d10c0](https://github.com/popstas/windows11-manager/commit/f2d10c0ab58cf5bfbb16c92183b0826cf8ebf614))
* **tray:** add Linux support for sleep/shutdown ([2f07b72](https://github.com/popstas/windows11-manager/commit/2f07b7245ef67867d1de5a203c5dd4de6e216e5a))
* **tray:** add Restart with Store, Sleep, and Shutdown power menu items ([92b6a8d](https://github.com/popstas/windows11-manager/commit/92b6a8da7053c9b625d3e51fb83efc3540a90936))
* **tray:** add Set Wallpapers menu item ([8233a9c](https://github.com/popstas/windows11-manager/commit/8233a9cc25f6e2cd6fb05e154da16a4b01b5d6ce))
* **tray:** add store windows interval setting ([fc8614f](https://github.com/popstas/windows11-manager/commit/fc8614fadd5ae37429f366693c172175cce03810))
* **tray:** keep app running in tray when windows are closed ([3b62097](https://github.com/popstas/windows11-manager/commit/3b62097f4cdcb7bf1f265381d0f04ce3924a9957))


### Bug Fixes

* add cargo.lock to sync version files ([46903ff](https://github.com/popstas/windows11-manager/commit/46903ffecf31703e7f8012fc898df7969cd2bf31))
* **build:** sync version before tauri build to fix wrong installer version ([8e02252](https://github.com/popstas/windows11-manager/commit/8e022526a630dafe0a38457a96c0626636a19f00))
* catch restore windows exceptions ([bd41349](https://github.com/popstas/windows11-manager/commit/bd413497f0401c9e495f649b0f013091d264295e))
* **ci:** add release-please manifest for v4 ([24f115e](https://github.com/popstas/windows11-manager/commit/24f115e760af6981ff8c651543f70e332621cf75))
* **ci:** avoid fromJSON on empty pr output ([e3856e8](https://github.com/popstas/windows11-manager/commit/e3856e8572ee562eab011ebea1f8ff1196a237a3))
* **ci:** parse release-please pr output for gh checkout ([5e72d6e](https://github.com/popstas/windows11-manager/commit/5e72d6e4159f5e0767a858ae7bd17980946b3e25))
* **ci:** set GH_TOKEN for gh in release-please step ([bff944a](https://github.com/popstas/windows11-manager/commit/bff944a196a3b52fa0bd1596c4f9b0030f982e2f))
* **dashboard:** prevent infinite loading hang ([d001615](https://github.com/popstas/windows11-manager/commit/d001615d532c845ad534c9418480ed289e53834d))
* fancyZonesToPos for monitors with scaled resolution ([376c219](https://github.com/popstas/windows11-manager/commit/376c219cfc2cf03d42cad6908c7d68af57051426))
* Fix monitor scaling when moving windows ([#3](https://github.com/popstas/windows11-manager/issues/3)) ([18ac3c8](https://github.com/popstas/windows11-manager/commit/18ac3c86fc7a08cd02f602a79839ad83fd6fc4d9))
* fix mutation in storeWindows ([80debd6](https://github.com/popstas/windows11-manager/commit/80debd6733d73131998afb3abd424a4af08d6468))
* ignore small windows placement (context menus for obs, etc) ([a3b7daa](https://github.com/popstas/windows11-manager/commit/a3b7daae85e43706ace522a5a70b6dcae97371e3))
* isWindowMatchRule fixes, less logging without debug, better error handling, update VirtualDesktop11.exe ([d60556a](https://github.com/popstas/windows11-manager/commit/d60556a678f45395ea8d347188d93ce26a2be5ae))
* log file name when no window title ([c8cf6aa](https://github.com/popstas/windows11-manager/commit/c8cf6aae5c6dfeaea9a9b1afed76b983d39c87da))
* more fast new process window place ([e00cc3c](https://github.com/popstas/windows11-manager/commit/e00cc3c33c4e5fdcf2f5a7f95dd5dc23546610c8))
* move virtualDesktopPath to config ([f58f91d](https://github.com/popstas/windows11-manager/commit/f58f91dd02f4f10a4e246f1ef0aaf66296dd15a9))
* order monitors by rows ([4dd82b4](https://github.com/popstas/windows11-manager/commit/4dd82b4effc5eaa9d3655e32c2e13851af5df0a1))
* placement improvements ([#4](https://github.com/popstas/windows11-manager/issues/4)) ([2dbe598](https://github.com/popstas/windows11-manager/commit/2dbe5980689cc1094f7fd2ac063acd9c4a844f92))
* **placement:** guard setBounds for offscreen windows ([3c3dbae](https://github.com/popstas/windows11-manager/commit/3c3dbaee723b13cd431349e99e40b32ce5b6da96))
* **placement:** write summary to log file ([ec8689c](https://github.com/popstas/windows11-manager/commit/ec8689c05cf93a5857d7e46e0398d11af3c180e4))
* PowerToys v0.58.0 compatible ([ebd3e4d](https://github.com/popstas/windows11-manager/commit/ebd3e4d0b06ccad763ef11a14cbea9a5e09634f1))
* remove ffi-napi, ref-napi, disable process monitor, update node-windows-manager ([3d28c9d](https://github.com/popstas/windows11-manager/commit/3d28c9dd3231b48a8a79fafd4522bfa704b1943b))
* resolve dashboard loading and double tray icon bugs ([8966e1b](https://github.com/popstas/windows11-manager/commit/8966e1bfd137099be4054f0039848425f18224a4))
* **tauri:** add force-exit watchdog and logging to exit handler ([2210e7b](https://github.com/popstas/windows11-manager/commit/2210e7be1222cf10ac078bb521ac3b3025c520e9))
* **tauri:** fix compilation errors and add missing icon files ([93349fe](https://github.com/popstas/windows11-manager/commit/93349fe96b2e8dcb2f69a90ddac053f074ad006b))
* **tauri:** fix settings save by enabling withGlobalTauri and set default project path ([859c66d](https://github.com/popstas/windows11-manager/commit/859c66da1f8ff4605382df2ac5cb4978cd8a566e))
* **tauri:** fix settings window and open it on missing project path ([24b941e](https://github.com/popstas/windows11-manager/commit/24b941e8d61928348f47f38e3b758aa65bc04e95))
* **tauri:** fix tray icon click on Windows 11 ([48d3ac8](https://github.com/popstas/windows11-manager/commit/48d3ac802ebbce9e917e467cafd36e96d3022b51))
* **tauri:** run MQTT and WS server on Tauri runtime ([1897e20](https://github.com/popstas/windows11-manager/commit/1897e20cd1014865bd1e80f531463e090ba4397d))
* **tray:** fix open_url call signature ([5741239](https://github.com/popstas/windows11-manager/commit/5741239c3864cad3dbdd1f9c10ea79d80d1f5229))
* **tray:** remove needless borrows for clippy ([fbf8052](https://github.com/popstas/windows11-manager/commit/fbf8052e73bf14e7c43f5a390116391e30601c1e))
* **tray:** Restart (Store) completes and reboots ([a81c23a](https://github.com/popstas/windows11-manager/commit/a81c23ac0064c8922747c8c52f58071e529eae9d))
* update for new PowerToys ([f89249a](https://github.com/popstas/windows11-manager/commit/f89249aea07b4e7272ab813315e67bca637ee751))
* update virtualdesktop11.exe for Windows 24H2 ([f745405](https://github.com/popstas/windows11-manager/commit/f745405d48ada6da7ce7ece902c5844e12776873))
* working exclude when pathMatch ([1c0d36a](https://github.com/popstas/windows11-manager/commit/1c0d36aa2175c35d51c09a942cf3f9574418e553))


### Code Refactoring

* **core:** extract pure logic for unit tests ([29cbcfc](https://github.com/popstas/windows11-manager/commit/29cbcfcc2e1835db1a3904566966f072fceecd52))
* **geometry:** extract offset/gap functions ([204d626](https://github.com/popstas/windows11-manager/commit/204d6264a09e902ce2a17adb135082a76b690d15))
* migrate codebase from CJS to ESM ([76ea22c](https://github.com/popstas/windows11-manager/commit/76ea22c7f6fac2a82e8a9b6c8b72a8d49ed28040))
* **tray:** use tauri-plugin-opener for URLs ([2eefa2b](https://github.com/popstas/windows11-manager/commit/2eefa2b89c6c3ac2c610befa6215bfbf9f926207))
* **virtual-desktop:** resolve exe from project root ([5e1ee70](https://github.com/popstas/windows11-manager/commit/5e1ee70ece5d3da453d8083b458d9ac7c146c488))

## [1.0.0](https://github.com/popstas/windows11-manager/compare/windows11-manager-v0.3.5...windows11-manager-v1.0.0) (2026-02-24)


### ⚠ BREAKING CHANGES

* migrate codebase from CJS to ESM

### Features

* Add monitor gap support for FancyZones ([#7](https://github.com/popstas/windows11-manager/issues/7)) ([79c1302](https://github.com/popstas/windows11-manager/commit/79c130243c09878fcb3e436d573d7faf7a8cbdf8))
* add place command via CLI and HTTP ([7126e1f](https://github.com/popstas/windows11-manager/commit/7126e1f0b72f3cc08f4670c91d1f33e998a02bf3))
* Add reloadConfigs function to dynamically reload configuration files ([15a491d](https://github.com/popstas/windows11-manager/commit/15a491d10d611cc886c62777d0c324e4922d2be6))
* bring window to top after place ([4758065](https://github.com/popstas/windows11-manager/commit/47580655cfe22f619200133a38eae2e660acd1ce))
* **ci:** add GitHub Actions release workflow and fix Windows build ([284d82b](https://github.com/popstas/windows11-manager/commit/284d82b3a2a47c287d91145a450ff5a551e2609b))
* command line: place, store, restore, stats ([8b4b957](https://github.com/popstas/windows11-manager/commit/8b4b957d4d4085443d90cb347bfa5ceca038e744))
* **config:** support loading config from multiple locations ([ec986ba](https://github.com/popstas/windows11-manager/commit/ec986ba294969307d8ae211d8fe570f87c9a961e))
* **dashboard:** add main dashboard window opened on tray icon click ([af83414](https://github.com/popstas/windows11-manager/commit/af8341400b0432338478cc4d4266f959b6618e94))
* implement addFancyZoneHistory ([#5](https://github.com/popstas/windows11-manager/issues/5)) ([cf5e247](https://github.com/popstas/windows11-manager/commit/cf5e247d749dd1f0966920da17b9d35ed1e646e7))
* **mqtt:** add MQTT client for remote control ([2abe9c2](https://github.com/popstas/windows11-manager/commit/2abe9c26612fc32576e25e35270e448a0acbd740))
* **mqtt:** move MQTT to Rust with WS bridge ([3092d04](https://github.com/popstas/windows11-manager/commit/3092d042d279bfb525e6deb563fbd36585f8e12a))
* **openWindows:** support arguments for restore windows ([c05d998](https://github.com/popstas/windows11-manager/commit/c05d998ea8d5c5f443260e3f7ab8fcfb48625c85))
* pin monitor to num by name ([f8ff010](https://github.com/popstas/windows11-manager/commit/f8ff010e7c143d5bb9ae76e04ad380482ffbad8c))
* **place:** verbose output and placement history ([250f71f](https://github.com/popstas/windows11-manager/commit/250f71f61e366f689c0d7e51e402be28481f64fe))
* placeWindows, autoplace, setWallpapers, store/restore, fancyZones, stats, placeWindowOnOpen, focusWindow ([08b864c](https://github.com/popstas/windows11-manager/commit/08b864cf078d63c82e7e94d895247e27d47bf7d9))
* reload configs when FancyZones layout changes ([#6](https://github.com/popstas/windows11-manager/issues/6)) ([a979f48](https://github.com/popstas/windows11-manager/commit/a979f487ed979a72723829227f837d78c70d705c))
* rule.onlyOnOpen ([84d17d7](https://github.com/popstas/windows11-manager/commit/84d17d77c25616b58fbee0cd347f06d87cacc655))
* **tauri:** add tray app with Place Windows and Autoplacer ([65474c2](https://github.com/popstas/windows11-manager/commit/65474c21f8a26ce8b8dafcb6e5d4139ee58744b9))
* **tray:** add Restart with Store, Sleep, and Shutdown power menu items ([92b6a8d](https://github.com/popstas/windows11-manager/commit/92b6a8da7053c9b625d3e51fb83efc3540a90936))
* **tray:** keep app running in tray when windows are closed ([3b62097](https://github.com/popstas/windows11-manager/commit/3b62097f4cdcb7bf1f265381d0f04ce3924a9957))


### Bug Fixes

* catch restore windows exceptions ([bd41349](https://github.com/popstas/windows11-manager/commit/bd413497f0401c9e495f649b0f013091d264295e))
* **ci:** add release-please manifest for v4 ([24f115e](https://github.com/popstas/windows11-manager/commit/24f115e760af6981ff8c651543f70e332621cf75))
* **ci:** parse release-please pr output for gh checkout ([5e72d6e](https://github.com/popstas/windows11-manager/commit/5e72d6e4159f5e0767a858ae7bd17980946b3e25))
* **ci:** set GH_TOKEN for gh in release-please step ([bff944a](https://github.com/popstas/windows11-manager/commit/bff944a196a3b52fa0bd1596c4f9b0030f982e2f))
* **dashboard:** prevent infinite loading hang ([d001615](https://github.com/popstas/windows11-manager/commit/d001615d532c845ad534c9418480ed289e53834d))
* fancyZonesToPos for monitors with scaled resolution ([376c219](https://github.com/popstas/windows11-manager/commit/376c219cfc2cf03d42cad6908c7d68af57051426))
* Fix monitor scaling when moving windows ([#3](https://github.com/popstas/windows11-manager/issues/3)) ([18ac3c8](https://github.com/popstas/windows11-manager/commit/18ac3c86fc7a08cd02f602a79839ad83fd6fc4d9))
* fix mutation in storeWindows ([80debd6](https://github.com/popstas/windows11-manager/commit/80debd6733d73131998afb3abd424a4af08d6468))
* ignore small windows placement (context menus for obs, etc) ([a3b7daa](https://github.com/popstas/windows11-manager/commit/a3b7daae85e43706ace522a5a70b6dcae97371e3))
* isWindowMatchRule fixes, less logging without debug, better error handling, update VirtualDesktop11.exe ([d60556a](https://github.com/popstas/windows11-manager/commit/d60556a678f45395ea8d347188d93ce26a2be5ae))
* log file name when no window title ([c8cf6aa](https://github.com/popstas/windows11-manager/commit/c8cf6aae5c6dfeaea9a9b1afed76b983d39c87da))
* more fast new process window place ([e00cc3c](https://github.com/popstas/windows11-manager/commit/e00cc3c33c4e5fdcf2f5a7f95dd5dc23546610c8))
* move virtualDesktopPath to config ([f58f91d](https://github.com/popstas/windows11-manager/commit/f58f91dd02f4f10a4e246f1ef0aaf66296dd15a9))
* order monitors by rows ([4dd82b4](https://github.com/popstas/windows11-manager/commit/4dd82b4effc5eaa9d3655e32c2e13851af5df0a1))
* placement improvements ([#4](https://github.com/popstas/windows11-manager/issues/4)) ([2dbe598](https://github.com/popstas/windows11-manager/commit/2dbe5980689cc1094f7fd2ac063acd9c4a844f92))
* PowerToys v0.58.0 compatible ([ebd3e4d](https://github.com/popstas/windows11-manager/commit/ebd3e4d0b06ccad763ef11a14cbea9a5e09634f1))
* remove ffi-napi, ref-napi, disable process monitor, update node-windows-manager ([3d28c9d](https://github.com/popstas/windows11-manager/commit/3d28c9dd3231b48a8a79fafd4522bfa704b1943b))
* resolve dashboard loading and double tray icon bugs ([8966e1b](https://github.com/popstas/windows11-manager/commit/8966e1bfd137099be4054f0039848425f18224a4))
* **tauri:** fix compilation errors and add missing icon files ([93349fe](https://github.com/popstas/windows11-manager/commit/93349fe96b2e8dcb2f69a90ddac053f074ad006b))
* **tauri:** fix settings save by enabling withGlobalTauri and set default project path ([859c66d](https://github.com/popstas/windows11-manager/commit/859c66da1f8ff4605382df2ac5cb4978cd8a566e))
* **tauri:** fix settings window and open it on missing project path ([24b941e](https://github.com/popstas/windows11-manager/commit/24b941e8d61928348f47f38e3b758aa65bc04e95))
* **tauri:** fix tray icon click on Windows 11 ([48d3ac8](https://github.com/popstas/windows11-manager/commit/48d3ac802ebbce9e917e467cafd36e96d3022b51))
* **tauri:** run MQTT and WS server on Tauri runtime ([1897e20](https://github.com/popstas/windows11-manager/commit/1897e20cd1014865bd1e80f531463e090ba4397d))
* **tray:** Restart (Store) completes and reboots ([a81c23a](https://github.com/popstas/windows11-manager/commit/a81c23ac0064c8922747c8c52f58071e529eae9d))
* update for new PowerToys ([f89249a](https://github.com/popstas/windows11-manager/commit/f89249aea07b4e7272ab813315e67bca637ee751))
* update virtualdesktop11.exe for Windows 24H2 ([f745405](https://github.com/popstas/windows11-manager/commit/f745405d48ada6da7ce7ece902c5844e12776873))
* working exclude when pathMatch ([1c0d36a](https://github.com/popstas/windows11-manager/commit/1c0d36aa2175c35d51c09a942cf3f9574418e553))


### Code Refactoring

* migrate codebase from CJS to ESM ([76ea22c](https://github.com/popstas/windows11-manager/commit/76ea22c7f6fac2a82e8a9b6c8b72a8d49ed28040))

## [0.3.4](https://github.com/popstas/windows11-manager/compare/v0.3.3...v0.3.4) (2026-02-23)



## [0.3.3](https://github.com/popstas/windows11-manager/compare/v0.3.2...v0.3.3) (2026-02-23)


### Bug Fixes

* **tauri:** fix compilation errors and add missing icon files ([93349fe](https://github.com/popstas/windows11-manager/commit/93349fe96b2e8dcb2f69a90ddac053f074ad006b))
* **tauri:** fix settings save by enabling withGlobalTauri and set default project path ([859c66d](https://github.com/popstas/windows11-manager/commit/859c66da1f8ff4605382df2ac5cb4978cd8a566e))
* **tauri:** fix settings window and open it on missing project path ([24b941e](https://github.com/popstas/windows11-manager/commit/24b941e8d61928348f47f38e3b758aa65bc04e95))
* **tauri:** fix tray icon click on Windows 11 ([48d3ac8](https://github.com/popstas/windows11-manager/commit/48d3ac802ebbce9e917e467cafd36e96d3022b51))


### Features

* **ci:** add GitHub Actions release workflow and fix Windows build ([284d82b](https://github.com/popstas/windows11-manager/commit/284d82b3a2a47c287d91145a450ff5a551e2609b))
* **config:** support loading config from multiple locations ([ec986ba](https://github.com/popstas/windows11-manager/commit/ec986ba294969307d8ae211d8fe570f87c9a961e))
* **place:** verbose output and placement history ([250f71f](https://github.com/popstas/windows11-manager/commit/250f71f61e366f689c0d7e51e402be28481f64fe))
* **tauri:** add tray app with Place Windows and Autoplacer ([65474c2](https://github.com/popstas/windows11-manager/commit/65474c21f8a26ce8b8dafcb6e5d4139ee58744b9))



## [0.3.2](https://github.com/popstas/windows11-manager/compare/v0.3.1...v0.3.2) (2026-02-16)


### Bug Fixes

* ignore small windows placement (context menus for obs, etc) ([a3b7daa](https://github.com/popstas/windows11-manager/commit/a3b7daae85e43706ace522a5a70b6dcae97371e3))



## [0.3.1](https://github.com/popstas/windows11-manager/compare/v0.3.0...v0.3.1) (2025-10-18)


### Features

* Add monitor gap support for FancyZones ([#7](https://github.com/popstas/windows11-manager/issues/7)) ([79c1302](https://github.com/popstas/windows11-manager/commit/79c130243c09878fcb3e436d573d7faf7a8cbdf8))
* implement addFancyZoneHistory ([#5](https://github.com/popstas/windows11-manager/issues/5)) ([cf5e247](https://github.com/popstas/windows11-manager/commit/cf5e247d749dd1f0966920da17b9d35ed1e646e7))
* reload configs when FancyZones layout changes ([#6](https://github.com/popstas/windows11-manager/issues/6)) ([a979f48](https://github.com/popstas/windows11-manager/commit/a979f487ed979a72723829227f837d78c70d705c))



# [0.3.0](https://github.com/popstas/windows11-manager/compare/v0.2.1...v0.3.0) (2025-07-05)


### Bug Fixes

* fancyZonesToPos for monitors with scaled resolution ([376c219](https://github.com/popstas/windows11-manager/commit/376c219cfc2cf03d42cad6908c7d68af57051426))
* Fix monitor scaling when moving windows ([#3](https://github.com/popstas/windows11-manager/issues/3)) ([18ac3c8](https://github.com/popstas/windows11-manager/commit/18ac3c86fc7a08cd02f602a79839ad83fd6fc4d9))
* log file name when no window title ([c8cf6aa](https://github.com/popstas/windows11-manager/commit/c8cf6aae5c6dfeaea9a9b1afed76b983d39c87da))
* placement improvements ([#4](https://github.com/popstas/windows11-manager/issues/4)) ([2dbe598](https://github.com/popstas/windows11-manager/commit/2dbe5980689cc1094f7fd2ac063acd9c4a844f92))



## [0.2.1](https://github.com/popstas/windows11-manager/compare/v0.2.0...v0.2.1) (2025-06-16)


### Bug Fixes

* update virtualdesktop11.exe for Windows 24H2 ([f745405](https://github.com/popstas/windows11-manager/commit/f745405d48ada6da7ce7ece902c5844e12776873))



# [0.2.0](https://github.com/popstas/windows11-manager/compare/v0.1.5...v0.2.0) (2024-11-22)


### Features

* Add reloadConfigs function to dynamically reload configuration files ([15a491d](https://github.com/popstas/windows11-manager/commit/15a491d10d611cc886c62777d0c324e4922d2be6))



## [0.1.5](https://github.com/popstas/windows11-manager/compare/v0.1.4...v0.1.5) (2024-11-15)


### Bug Fixes

* remove ffi-napi, ref-napi, disable process monitor, update node-windows-manager ([3d28c9d](https://github.com/popstas/windows11-manager/commit/3d28c9dd3231b48a8a79fafd4522bfa704b1943b))



## [0.1.4](https://github.com/popstas/windows11-manager/compare/v0.1.3...v0.1.4) (2024-04-23)


### Bug Fixes

* isWindowMatchRule fixes, less logging without debug, better error handling, update VirtualDesktop11.exe ([d60556a](https://github.com/popstas/windows11-manager/commit/d60556a678f45395ea8d347188d93ce26a2be5ae))



## [0.1.3](https://github.com/popstas/windows11-manager/compare/v0.1.2...v0.1.3) (2023-02-26)


### Features

* bring window to top after place ([4758065](https://github.com/popstas/windows11-manager/commit/47580655cfe22f619200133a38eae2e660acd1ce))
* pin monitor to num by name ([f8ff010](https://github.com/popstas/windows11-manager/commit/f8ff010e7c143d5bb9ae76e04ad380482ffbad8c))



## [0.1.2](https://github.com/popstas/windows11-manager/compare/v0.1.1...v0.1.2) (2023-02-12)


### Bug Fixes

* catch restore windows exceptions ([bd41349](https://github.com/popstas/windows11-manager/commit/bd413497f0401c9e495f649b0f013091d264295e))
* order monitors by rows ([4dd82b4](https://github.com/popstas/windows11-manager/commit/4dd82b4effc5eaa9d3655e32c2e13851af5df0a1))
* PowerToys v0.58.0 compatible ([ebd3e4d](https://github.com/popstas/windows11-manager/commit/ebd3e4d0b06ccad763ef11a14cbea9a5e09634f1))


### Features

* command line: place, store, restore, stats ([8b4b957](https://github.com/popstas/windows11-manager/commit/8b4b957d4d4085443d90cb347bfa5ceca038e744))
* rule.onlyOnOpen ([84d17d7](https://github.com/popstas/windows11-manager/commit/84d17d77c25616b58fbee0cd347f06d87cacc655))



## [0.1.1](https://github.com/popstas/windows11-manager/compare/08b864cf078d63c82e7e94d895247e27d47bf7d9...v0.1.1) (2022-04-23)


### Bug Fixes

* fix mutation in storeWindows ([80debd6](https://github.com/popstas/windows11-manager/commit/80debd6733d73131998afb3abd424a4af08d6468))
* more fast new process window place ([e00cc3c](https://github.com/popstas/windows11-manager/commit/e00cc3c33c4e5fdcf2f5a7f95dd5dc23546610c8))
* move virtualDesktopPath to config ([f58f91d](https://github.com/popstas/windows11-manager/commit/f58f91dd02f4f10a4e246f1ef0aaf66296dd15a9))
* update for new PowerToys ([f89249a](https://github.com/popstas/windows11-manager/commit/f89249aea07b4e7272ab813315e67bca637ee751))
* working exclude when pathMatch ([1c0d36a](https://github.com/popstas/windows11-manager/commit/1c0d36aa2175c35d51c09a942cf3f9574418e553))


### Features

* **openWindows:** support arguments for restore windows ([c05d998](https://github.com/popstas/windows11-manager/commit/c05d998ea8d5c5f443260e3f7ab8fcfb48625c85))
* placeWindows, autoplace, setWallpapers, store/restore, fancyZones, stats, placeWindowOnOpen, focusWindow ([08b864c](https://github.com/popstas/windows11-manager/commit/08b864cf078d63c82e7e94d895247e27d47bf7d9))
