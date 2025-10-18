## [0.3.1](https://github.com/popstas/windows11-manager/compare/v0.3.0...v0.3.1) (2025-10-18)


### Features

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



