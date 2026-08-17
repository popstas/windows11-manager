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



## [3.1.0](https://github.com/popstas/windows11-manager/compare/windows11-manager-v3.0.0...windows11-manager-v3.1.0) (2026-08-17)


### Features

* **claude-wt:** команда собирается из реестра терминалов сложением ([3a7cff7](https://github.com/popstas/windows11-manager/commit/3a7cff7e8a348ffd062e4b3e3c7a3dc84d21d3c3))
* **claude-wt:** окном терминала считается и WezTerm ([a83b052](https://github.com/popstas/windows11-manager/commit/a83b052ccf941032819c1255fcbbb37d0de53559))
* **claude-wt:** профиль проекта — карта по имени терминала ([0449e83](https://github.com/popstas/windows11-manager/commit/0449e8300437e7b1869e681c6937dad7398e32ad))
* **claude-wt:** реестр терминалов — имя, команда и профильные аргументы ([aae3ea7](https://github.com/popstas/windows11-manager/commit/aae3ea7bdc66977e3589fa489822efa014426b72))
* **claude-wt:** реестр терминалов и подъём сессии без слота ([d64b191](https://github.com/popstas/windows11-manager/commit/d64b1916141dde4617e6d4b541b9defd8b0f0d4c))
* **claude-wt:** терминал из просьбы главнее дефолта машины ([4078ca7](https://github.com/popstas/windows11-manager/commit/4078ca7ad105a9dc339f577c1abf1a22110b7a2a))
* **claude-wt:** файл окон называет терминал каждого окна ([d92aeae](https://github.com/popstas/windows11-manager/commit/d92aeaedff9e05d2a114357c91760d862eeb9de3))
* **tray:** пункт меню называет время сборки ([f1f6e56](https://github.com/popstas/windows11-manager/commit/f1f6e56e401eb7490367893c4246f60a2ab06646))


### Bug Fixes

* **claude-wt:** имя терминала не терялось по дороге к файлу окон ([87161df](https://github.com/popstas/windows11-manager/commit/87161dfafde73d6a88b981400260813c4e24397f))
* **claude-wt:** испорченные terminalExecutables не гасят встроенный список ([965694a](https://github.com/popstas/windows11-manager/commit/965694ab7ef50362996ae36195d3306bcc63f826))
* **claude-wt:** развилка терминала — общий помощник, лог отката, честная старость блока ([4e12f07](https://github.com/popstas/windows11-manager/commit/4e12f0703339e870fddb2d7e56a5af2f808ee326))
* **claude-wt:** регрессия пустого профиля, терминал в живом восстановлении, англ. текст ошибок ([9654071](https://github.com/popstas/windows11-manager/commit/9654071a1ee08baed5d0b976e2e9f1faa8657af3))
* **claude-wt:** сессия без слота поднимается сама, а не подменяется чистой ([07655ba](https://github.com/popstas/windows11-manager/commit/07655ba05a722c2560a399adf9c30d7cad0d1dff))
* **claude-wt:** убрать command из умолчаний launch — реестр терминалов был недостижим ([bb5a849](https://github.com/popstas/windows11-manager/commit/bb5a849f562064379a2fde7c64b6c324a11589e2))
* **tray:** подпись версии начинается с версии, как в соседних треях ([082f442](https://github.com/popstas/windows11-manager/commit/082f442a289f16e746e24af36e513ae8d20456e7))


### Performance Improvements

* **build:** incremental в профиле release — 78,7 с → 13,3 с ([6a26dcc](https://github.com/popstas/windows11-manager/commit/6a26dcc3850498eeeb7036d8bf5678fa4eef2e6a))

## [3.0.0](https://github.com/popstas/windows11-manager/compare/windows11-manager-v2.1.0...windows11-manager-v3.0.0) (2026-08-15)


### Features

* **claude-wt:** agent state, snapshots, project open ([c72a334](https://github.com/popstas/windows11-manager/commit/c72a334abb6287beb9142a3185fb3e0b144906ed))
* **claude-wt:** apply profile on restore and snapshot launch ([371b601](https://github.com/popstas/windows11-manager/commit/371b601eba8afede2079339e5e629015052159cb))
* **claude-wt:** applyWtProfile strip-and-reinject helper ([dd89f60](https://github.com/popstas/windows11-manager/commit/dd89f6062f8ab5c45799fcb2af72d1bf296cba2f))
* **claude-wt:** claude-session-open открывает сессию по каталогу проекта ([b4dad43](https://github.com/popstas/windows11-manager/commit/b4dad43391f40c44f909c6b6b397496da7b60415))
* **claude-wt:** cost, context и started ([4555794](https://github.com/popstas/windows11-manager/commit/4555794c8bdfb8f94c8c5b5e2cc2d372f1e9d935))
* **claude-wt:** export claudeWtSnapshots API ([ba48083](https://github.com/popstas/windows11-manager/commit/ba48083704858f4006e037c40ace619724d5dee7))
* **claude-wt:** expose last user prompt ([edecc36](https://github.com/popstas/windows11-manager/commit/edecc36259536627df25bf03a2d04456bb19799f))
* **claude-wt:** markSessionUnread и подавление возвратного фокуса ([8e74be5](https://github.com/popstas/windows11-manager/commit/8e74be5a1fb103309e8936f250d16ea028858513))
* **claude-wt:** open project by hotkey cwd ([9ee4dc7](https://github.com/popstas/windows11-manager/commit/9ee4dc7b1d8f4b4ee8f8879f1b14a3720675431b))
* **claude-wt:** openClaudeProject умеет заводить сессию, не поднимая открытую ([5e273cb](https://github.com/popstas/windows11-manager/commit/5e273cb6ecb8f95765e68d96d7495e4278f39343))
* **claude-wt:** POST /claude-wt/focus поднимает окно сессии по id ([3e48f70](https://github.com/popstas/windows11-manager/commit/3e48f7078b7dcaf008638d6f16f124abd4f03b41))
* **claude-wt:** profile on launchNew and config default ([7c9facc](https://github.com/popstas/windows11-manager/commit/7c9facca9b39a1d3ca251671c2f2e8bef2fc2e17))
* **claude-wt:** projects list and profileForCwd ([772fb9f](https://github.com/popstas/windows11-manager/commit/772fb9f38923c7a2de57891fef6cfbb6ee93338e))
* **claude-wt:** resolve profiles per session ([1bf54c9](https://github.com/popstas/windows11-manager/commit/1bf54c9db578add2506a62374928b80990b88b8b))
* **claude-wt:** startHttpServer наружу из пакета ([316970d](https://github.com/popstas/windows11-manager/commit/316970d268ac7d462f0f924e647c117f8a9aaaa9))
* **claude-wt:** terminal-new — открыть сессию, не поднимая существующую ([ee5f5d7](https://github.com/popstas/windows11-manager/commit/ee5f5d735f28f2abedbf838c76445d7fc0e3fb36))
* **claude-wt:** в файле окон едет отметка о взгляде на окно ([250d587](https://github.com/popstas/windows11-manager/commit/250d5878a938a5644ff0cf13d8b482c9d3db950f))
* **claude-wt:** ветка и pr_url в строке сессии ([cf315bd](https://github.com/popstas/windows11-manager/commit/cf315bd695f7c40097e6f4436fe011f4e19e25ed))
* **claude-wt:** вид уходит вслед за окном, уехавшим на чужой стол ([0f90fa1](https://github.com/popstas/windows11-manager/commit/0f90fa168f0802237d49159a076293346e574e1a))
* **claude-wt:** демон отдаёт статистику тиков ([6da0a10](https://github.com/popstas/windows11-manager/commit/6da0a10dfae8dc3fcfe6796dd557790e791455a7))
* **claude-wt:** демон публикует файл окон для читателей на той стороне ([d87ff15](https://github.com/popstas/windows11-manager/commit/d87ff1515fdce929fb2e14dd4e9e31df6a5653b7))
* **claude-wt:** начало хода и вопрос агента в состоянии сессии ([9a96c95](https://github.com/popstas/windows11-manager/commit/9a96c954a118deee772076fc5b0d02910decc888))
* **claude-wt:** одна строка сводки на всех читателей ([a6e39ee](https://github.com/popstas/windows11-manager/commit/a6e39ee5b30519eb91b5810c59a2a68429f54d6f))
* **claude-wt:** отдавать событие и текст уведомления агента ([89cec86](https://github.com/popstas/windows11-manager/commit/89cec860a149e1c7661b04369815d78f600d7844))
* **claude-wt:** отделить текущую сводку от последней известной ([601f343](https://github.com/popstas/windows11-manager/commit/601f343f1c2daa9fddfc7e15c56879a1158c66f1))
* **claude-wt:** отмечать сессию просмотренной по фокусу окна ([d55e4ce](https://github.com/popstas/windows11-manager/commit/d55e4ce0f53cc62a5ff85aa0b3b28f9fe6584e9a))
* **claude-wt:** сводка последнего ответа агента ([7eed2ec](https://github.com/popstas/windows11-manager/commit/7eed2ecab4ce826a7435885307e258390f4fcfcb))
* **claude-wt:** снапшоты раскладов сессий ([975eadd](https://github.com/popstas/windows11-manager/commit/975eaddea122b31b13651c189102e25c72968ccb))
* **claude-wt:** снимки раскладки в файле оконного трекера ([8ec89de](https://github.com/popstas/windows11-manager/commit/8ec89de95bb6f04301e23acf757f62af927ed6fb))
* **claude-wt:** состояние агента в списке сессий ([1cddde0](https://github.com/popstas/windows11-manager/commit/1cddde005b2eb76262acbd45fa72126a50a62b86))
* **claude-wt:** сторож замечает замолчавшего демона и снимает его процесс ([8ec39e1](https://github.com/popstas/windows11-manager/commit/8ec39e19ab5af723b69e8a5b1a4a7424f9a53711))
* **claude-wt:** фоновый агент говорит за сессию ([3d79537](https://github.com/popstas/windows11-manager/commit/3d79537b9100d184212a478f2c770a5d7c5d1d21))
* **claude-wt:** хоткеи проектов едут в файл трекера ([c638d64](https://github.com/popstas/windows11-manager/commit/c638d64e0a80d4ed716078194bbc11e776c79c1c))
* **claude-wt:** чистые функции живости демона ([20ae730](https://github.com/popstas/windows11-manager/commit/20ae7308cb9c673a32c7912d21d631af03cb572f))
* **claude-wt:** чистые функции пометки непрочитанным ([2b30d39](https://github.com/popstas/windows11-manager/commit/2b30d399122451a0e0ca3a4b573c672fd5217600))
* **claude-wt:** экспорт сессий в Home Assistant переехал из windows-mqtt ([c07085d](https://github.com/popstas/windows11-manager/commit/c07085dfc5bd477b43a2daba29ac07ff886d12d5))
* **commands:** autoplace рассказывает человеку о расставленных окнах ([5427290](https://github.com/popstas/windows11-manager/commit/5427290152706c44f48ac64e2434e07abf16a29e))
* **commands:** карта команд с единым разбором ошибок ([db1e270](https://github.com/popstas/windows11-manager/commit/db1e270fa86ce8bf84f69ac53c4a6f171c5b8a9e))
* **commands:** команды claude-wt переехали из windows-mqtt ([acbdc57](https://github.com/popstas/windows11-manager/commit/acbdc57de420be24919b5502802da5846ccb0af0))
* **commands:** оконные команды переехали из windows-mqtt ([75e7241](https://github.com/popstas/windows11-manager/commit/75e7241f3aeda67d50f8f80e85a1290691829bd6))
* **ha:** своё умолчание сортировки слотов — recent, не цена пикера ([6c76ae7](https://github.com/popstas/windows11-manager/commit/6c76ae78935fc4e491587b882a9f35722aa50278))
* **mqtt:** окно расставляется при открытии ([f6287ec](https://github.com/popstas/windows11-manager/commit/f6287ec6f3cf3150fb278b990a80b66ee6611d21))
* **mqtt:** свой клиент и команда mqtt вместо моста через Rust ([e2f021a](https://github.com/popstas/windows11-manager/commit/e2f021af7fdf46bafa20c1fa865f303184066ce1))
* **mqtt:** служба заводит статистику, расстановку и сторожа демона ([fe5c073](https://github.com/popstas/windows11-manager/commit/fe5c073fd69e079539757a6bd4b4fe0af01451ee))
* **mqtt:** статистика окон уезжает в Home Assistant раз в минуту ([b5059bc](https://github.com/popstas/windows11-manager/commit/b5059bcee3531669cdec8c6ecd722b717f34c74b))
* **tauri:** служба MQTT поднимается заново после выхода, как и демон ([f557e9b](https://github.com/popstas/windows11-manager/commit/f557e9badaf61db2d9017643c74e0429e23b7eed))
* **tray:** надзор за node-детьми и автостарт демона claude-wt ([63fb220](https://github.com/popstas/windows11-manager/commit/63fb2208d203860847b3ade509525a6a0db1f718))
* **tray:** хоткей расстановки окон вынесен в настройки ([066ce67](https://github.com/popstas/windows11-manager/commit/066ce67e29cad2aba70d425caf653e767a859473))


### Bug Fixes

* **claude-wt:** bind twin titles to newest hwnd ([ad8a0b5](https://github.com/popstas/windows11-manager/commit/ad8a0b5e8fab34814a8cad96339e958f838e068a))
* **claude-wt:** honor empty project.profile in profileForCwd ([e15c8fa](https://github.com/popstas/windows11-manager/commit/e15c8fa50700905ca22d0ac72475603022954f31))
* **claude-wt:** launchNew поднимает сессию интерактивным шеллом ([55408bd](https://github.com/popstas/windows11-manager/commit/55408bd755d5379d63bb1ef71de98d8afc8f8c4c))
* **claude-wt:** prefer hook for activity age ([bf82a03](https://github.com/popstas/windows11-manager/commit/bf82a035cdadabe9d8a2ef5b058faac0be41e65d))
* **claude-wt:** strip -p only in wt option prefix ([95e38bd](https://github.com/popstas/windows11-manager/commit/95e38bdfd4f579c879885cd26078d2b5b3ac5060))
* **claude-wt:** use optional chaining for launch.command in planWtLaunch ([c7cd2c7](https://github.com/popstas/windows11-manager/commit/c7cd2c71aa096ffaf28cb4f99f98928449ca8d62))
* **claude-wt:** верить хукам агентов, а не флагу live в дампе ([a1445b5](https://github.com/popstas/windows11-manager/commit/a1445b5ed97fa81a216f7dd5730d623f4ea4b1b2))
* **claude-wt:** вернуть потерянный слой view ([46c6253](https://github.com/popstas/windows11-manager/commit/46c6253a940cce9a8ab25b69e6a8a5242fec92f1))
* **claude-wt:** восстановление сессии тоже уходит на стол вслед за окном ([10db4c6](https://github.com/popstas/windows11-manager/commit/10db4c6160133e8c2b4664d2b9c0619d167621fe))
* **claude-wt:** дамп читается только после сброса кэша SMB ([a67e4ea](https://github.com/popstas/windows11-manager/commit/a67e4eacd8de5d2d94a4674677490e2f336d343b))
* **claude-wt:** закрыть дыры в тестах и убрать дублирование predicate ([822e753](https://github.com/popstas/windows11-manager/commit/822e753b5e461852c55f5d331eb204c167dcfef5))
* **claude-wt:** не верить одному mtime на сетевом диске ([8e52b42](https://github.com/popstas/windows11-manager/commit/8e52b42bafe76c6725d9fd3e496e744e3a80aea0))
* **claude-wt:** не терять markSessionUnread под тиком в полёте ([23858ee](https://github.com/popstas/windows11-manager/commit/23858eeabc700c8e926d7d1978bc5718551ca700))
* **claude-wt:** нулевая отметка хука — «не знаем», а не «1970 год» ([daf380f](https://github.com/popstas/windows11-manager/commit/daf380f278c2339e3581e5eeea698774e631fe23))
* **claude-wt:** окно новой сессии поднимается само, дождавшись расстановки ([73c9255](https://github.com/popstas/windows11-manager/commit/73c92554f6e862a044fbfecc0083ccb14ad0ab79))
* **claude-wt:** окно переходит на сессию, которую называет дамп ([92c53ce](https://github.com/popstas/windows11-manager/commit/92c53ce0f79ed7db8e57ad3b0e622514fb243b0b))
* **claude-wt:** остановленный демон убирает за собой файл окон ([a0f7e70](https://github.com/popstas/windows11-manager/commit/a0f7e7008e8a557cfc3f78a25860bac86167e232))
* **claude-wt:** отказ на незнакомое action слышен, докблоки честны про reuseOpen ([47d7be5](https://github.com/popstas/windows11-manager/commit/47d7be59ea8039901cfedf74325995e9730f5669))
* **claude-wt:** перезапуск отгораживает висящий тик и не восстанавливает сессии ([0e99d88](https://github.com/popstas/windows11-manager/commit/0e99d88e64ab6e50c70f8852c15ef1007c30f56a))
* **claude-wt:** по-записочный откат к пробе вместо групповой калитки ([fd24d1e](https://github.com/popstas/windows11-manager/commit/fd24d1efe7be038d4c4d1526c7962b0239928149))
* **claude-wt:** стол переучивается на фокусе, а не помнится с первой привязки ([45138bd](https://github.com/popstas/windows11-manager/commit/45138bd283aad0005c2d4750fcef0930604bc65d))
* **claude-wt:** сузить регулярку PR-ссылки до owner/repo без спецсимволов ([38e8f4a](https://github.com/popstas/windows11-manager/commit/38e8f4a94f1ecfcb999ac1cb1f208b23231b9ace))
* **claude-wt:** убрать неиспользуемый nowSec из slotUsage ([9fc52a1](https://github.com/popstas/windows11-manager/commit/9fc52a1c99c69a5c29a80657fe3e30e9a178183c))
* **claude-wt:** удавшееся восстановление снова видно в журнале ([01f52d7](https://github.com/popstas/windows11-manager/commit/01f52d795f3e49719642ea77f098d794de496950))
* **claude-wt:** управляющие байты в исходнике и отставшая копия скилла ([43dc66a](https://github.com/popstas/windows11-manager/commit/43dc66afbcc96d099bbd6cc600f1954e9446b95d))
* **claude-wt:** честный возраст в диагнозе и метка поколения тика ([9ad1a7b](https://github.com/popstas/windows11-manager/commit/9ad1a7bbec91036a794f2a713de201816a476b71))
* **claude-wt:** экспорт в HA читает homeassistant.sessionsSort и покрывает refresh/stop/slotOff ([667b83f](https://github.com/popstas/windows11-manager/commit/667b83f638d2459976a7b0b7d4fe8eb31320cb88))
* **commands:** parseRestorePayload принимает объект ([02e0598](https://github.com/popstas/windows11-manager/commit/02e059892d924a6dd8ecde0f562bcc14787b8bae))
* **commands:** reload действительно перечитывает конфиг ([43afb8d](https://github.com/popstas/windows11-manager/commit/43afb8d048668a9ad9a2ba3c93b3b74dbb33a41a))
* **commands:** битое тело команды видно в журнале ([72a7e7e](https://github.com/popstas/windows11-manager/commit/72a7e7e4b8f36f82d1a54eec399de47e333c5c27))
* **commands:** плитка панели гасится по разобранному номеру слота ([24af7de](https://github.com/popstas/windows11-manager/commit/24af7de6bd8df56e6aeddf8cd4f8082691d90790))
* **config:** unref таймера ватчера раскладок ([a886aa2](https://github.com/popstas/windows11-manager/commit/a886aa2db96bd74bfac6edac00980de53f092323))
* **ha:** доступность снимается при падении и при остановке ([9f2040f](https://github.com/popstas/windows11-manager/commit/9f2040ff9d2ce697d3d0faba072695851f9994a2))
* **ha:** номер слота в имени сущности и уборка слотов сверх текущего числа ([ad02ea3](https://github.com/popstas/windows11-manager/commit/ad02ea31740a0bf41ce486b759d003ecbade3e6d))
* **ha:** переподключение переиздаёт конфиги Discovery ([0a5f80e](https://github.com/popstas/windows11-manager/commit/0a5f80ef1cc2dcd63c96b40ced6aa07716e2b5cd))
* **log:** входящее и ошибки снова видны в журнале ([d457631](https://github.com/popstas/windows11-manager/commit/d457631fb0922558b977015458f1e69866159172))
* **monitors:** учитывать поворот и DPI, не сдвигать номера ([48f9103](https://github.com/popstas/windows11-manager/commit/48f9103769c39d79d81d87423204e99ef970f700))
* **mqtt:** активное окно без имени не публикует слово "undefined" ([8a05e0c](https://github.com/popstas/windows11-manager/commit/8a05e0c7d5a78276baaa6ce9e61bcb4e765d0d41))
* **mqtt:** сторож зовёт человека раз на поломку, статистика не держит окна ([c589378](https://github.com/popstas/windows11-manager/commit/c589378146eda08b6d70df4bed6f1689d3544661))
* **mqtt:** сторож не снимает pid из пролежавшего файла окон ([15a5f2d](https://github.com/popstas/windows11-manager/commit/15a5f2d2241bf2052facde0868b22bbf159b4d1b))
* **mqtt:** уведомления уходят туда, где их слушают ([e889a5b](https://github.com/popstas/windows11-manager/commit/e889a5b75a9305e6a12f36b0ea037ed8b225abaf))
* **mqtt:** упавшая расстановка окна больше не роняет процесс службы ([21f600a](https://github.com/popstas/windows11-manager/commit/21f600abc598d0096125475f32cf2a38e3732744))
* **tauri:** остановка демона из трея убирает опубликованный файл окон ([25dea55](https://github.com/popstas/windows11-manager/commit/25dea557460ee1df32610a27d922af3b7db1b54d))
* **tauri:** служба MQTT больше не поднимается вторым процессом ([31da594](https://github.com/popstas/windows11-manager/commit/31da594dd00c95eb4c7ea3691cf3dbfd6227b6ef))
* **tray:** умолчание хоткея — Ctrl+Alt+Win+0, комбинацию с Shift занять нельзя ([b932c0e](https://github.com/popstas/windows11-manager/commit/b932c0ed0884792b731960bf8040d8fb99a3b08b))
* **virtual-desktop:** null от VirtualDesktop11.exe больше не роняет вызов ([8842175](https://github.com/popstas/windows11-manager/commit/88421755bc1ca416b34ea5d2154e24229d64726b))


### Performance Improvements

* **claude-wt:** progressStamp только для дампов без activityAt ([4ce35ff](https://github.com/popstas/windows11-manager/commit/4ce35ff5e42b9081a7a961996d413a64994f6624))
* **claude-wt:** отметка активности берётся из дампа ([41534c8](https://github.com/popstas/windows11-manager/commit/41534c82fbda0dba9895972ec6b243f4787f897d))
* **claude-wt:** память на пробу за одну сборку индекса ([fa57cd9](https://github.com/popstas/windows11-manager/commit/fa57cd9e25cb6b43efac1550290cd942c5ebb490))
* **config:** конфиг разбирается заново только после правки ([37c6a90](https://github.com/popstas/windows11-manager/commit/37c6a908b52c9c84bfd1c85b42a88eed93636a28))


### Miscellaneous Chores

* выпустить 3.0.0 ([7e1417f](https://github.com/popstas/windows11-manager/commit/7e1417f91a11c8fca4a540fc647178fb1dc4e066))


### Code Refactoring

* **claude-wt:** маршруты окон убраны из http-сервера ([76a31c8](https://github.com/popstas/windows11-manager/commit/76a31c853e65b06c2f992f401507cce7bdb4b2f6))
* **claude-wt:** чистые хелперы слотов и нажатий переехали из windows-mqtt ([cac7579](https://github.com/popstas/windows11-manager/commit/cac7579bb3a765f2ba1858597320ab4411fe933a))
* **http:** сервер работает поверх карты команд ([b3457cb](https://github.com/popstas/windows11-manager/commit/b3457cb562ffe8de717da93ef5c91e5b7515eaa8))
* **tauri:** мост MQTT через Rust снесён, трей поднимает node-службу ([4dc8707](https://github.com/popstas/windows11-manager/commit/4dc8707d05c146238e3c7a48c1c8538974e9953a))
* **tray:** убрано поле ws_port вместе со снятым ws-мостом ([ac91d84](https://github.com/popstas/windows11-manager/commit/ac91d84ae1d3df2433695625db56d600d593451c))

## [2.1.0](https://github.com/popstas/windows11-manager/compare/windows11-manager-v2.0.1...windows11-manager-v2.1.0) (2026-07-31)


### Features

* **claude-wt:** позиционная память окон Claude Code ([#13](https://github.com/popstas/windows11-manager/issues/13)) ([20a8427](https://github.com/popstas/windows11-manager/commit/20a8427f573240a7125fbebe040649d3d0d0de00))

## [2.0.1](https://github.com/popstas/windows11-manager/compare/windows11-manager-v2.0.0...windows11-manager-v2.0.1) (2026-07-31)


### Performance Improvements

* **autoplace:** poll cheap visible hwnd ids instead of full window snapshots ([96c2584](https://github.com/popstas/windows11-manager/commit/96c25848b8b13c8f96970ce3729b7707cf04793e))

## [2.0.0](https://github.com/popstas/windows11-manager/compare/windows11-manager-v1.1.0...windows11-manager-v2.0.0) (2026-07-12)


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
* **config:** look up config in OS settings folder ([5ffa33f](https://github.com/popstas/windows11-manager/commit/5ffa33f8636d789b1b89a3300ef89329f55b32cb))
* **config:** support loading config from multiple locations ([ec986ba](https://github.com/popstas/windows11-manager/commit/ec986ba294969307d8ae211d8fe570f87c9a961e))
* **dashboard:** add app icons to stats table ([f701aee](https://github.com/popstas/windows11-manager/commit/f701aee95741a801ef036666908a3549aa1d6ad8))
* **dashboard:** add autorun checkboxes to stats ([3b27563](https://github.com/popstas/windows11-manager/commit/3b27563a208d189c167fc98d86ec0c652a98938b))
* **dashboard:** add log path and open log location ([6865a08](https://github.com/popstas/windows11-manager/commit/6865a08a9130e05badd03d38d02db27353061869))
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
* comment debug log in getConfig ([16d2e89](https://github.com/popstas/windows11-manager/commit/16d2e89aa3df2b847fe0142263ccfc3f78634db8))
* **config:** unwrap esm namespace and copy before attaching _configPath ([1033547](https://github.com/popstas/windows11-manager/commit/10335477776473217e441372501af185ac69e3d5))
* **dashboard:** prevent infinite loading hang ([d001615](https://github.com/popstas/windows11-manager/commit/d001615d532c845ad534c9418480ed289e53834d))
* **fancyzones:** correct DPI double-scaling ([d104e67](https://github.com/popstas/windows11-manager/commit/d104e67ba13ab786d02e9fc3aeaa05ee91c38e45))
* fancyZonesToPos for monitors with scaled resolution ([376c219](https://github.com/popstas/windows11-manager/commit/376c219cfc2cf03d42cad6908c7d68af57051426))
* **fancyzones:** use FancyZones dpi field for scale ([2446473](https://github.com/popstas/windows11-manager/commit/2446473757de9c755a120b86eb291cb0471aa38c))
* Fix monitor scaling when moving windows ([#3](https://github.com/popstas/windows11-manager/issues/3)) ([18ac3c8](https://github.com/popstas/windows11-manager/commit/18ac3c86fc7a08cd02f602a79839ad83fd6fc4d9))
* fix mutation in storeWindows ([80debd6](https://github.com/popstas/windows11-manager/commit/80debd6733d73131998afb3abd424a4af08d6468))
* ignore small windows placement (context menus for obs, etc) ([a3b7daa](https://github.com/popstas/windows11-manager/commit/a3b7daae85e43706ace522a5a70b6dcae97371e3))
* isWindowMatchRule fixes, less logging without debug, better error handling, update VirtualDesktop11.exe ([d60556a](https://github.com/popstas/windows11-manager/commit/d60556a678f45395ea8d347188d93ce26a2be5ae))
* log file name when no window title ([c8cf6aa](https://github.com/popstas/windows11-manager/commit/c8cf6aae5c6dfeaea9a9b1afed76b983d39c87da))
* more fast new process window place ([e00cc3c](https://github.com/popstas/windows11-manager/commit/e00cc3c33c4e5fdcf2f5a7f95dd5dc23546610c8))
* move virtualDesktopPath to config ([f58f91d](https://github.com/popstas/windows11-manager/commit/f58f91dd02f4f10a4e246f1ef0aaf66296dd15a9))
* **native:** plug getWindowTitle memory leak, drop duplicate getTitle call ([102346a](https://github.com/popstas/windows11-manager/commit/102346a44f261942caed582d3ec35978683b0fcd))
* order monitors by rows ([4dd82b4](https://github.com/popstas/windows11-manager/commit/4dd82b4effc5eaa9d3655e32c2e13851af5df0a1))
* placement improvements ([#4](https://github.com/popstas/windows11-manager/issues/4)) ([2dbe598](https://github.com/popstas/windows11-manager/commit/2dbe5980689cc1094f7fd2ac063acd9c4a844f92))
* **placement:** allow windows on left monitor ([2f4a257](https://github.com/popstas/windows11-manager/commit/2f4a2575c6e8a91affdd5c1dae3903b4742d3dd2))
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
* **tray:** use cmd start for open log ([83399b3](https://github.com/popstas/windows11-manager/commit/83399b37ad2d3ea4298a0edc2ff10f1b0fedc23c))
* untrack root config.js in favor of gitignored config.cjs ([a786fa9](https://github.com/popstas/windows11-manager/commit/a786fa9e76276737375a51209f79dbe00765274b))
* update for new PowerToys ([f89249a](https://github.com/popstas/windows11-manager/commit/f89249aea07b4e7272ab813315e67bca637ee751))
* update virtualdesktop11.exe for Windows 24H2 ([f745405](https://github.com/popstas/windows11-manager/commit/f745405d48ada6da7ce7ece902c5844e12776873))
* working exclude when pathMatch ([1c0d36a](https://github.com/popstas/windows11-manager/commit/1c0d36aa2175c35d51c09a942cf3f9574418e553))


### Code Refactoring

* **core:** extract pure logic for unit tests ([29cbcfc](https://github.com/popstas/windows11-manager/commit/29cbcfcc2e1835db1a3904566966f072fceecd52))
* Extract pure logic into helper files for unit testing ([#11](https://github.com/popstas/windows11-manager/issues/11)) ([47986ac](https://github.com/popstas/windows11-manager/commit/47986ac35c0172f3c43e5cb6063c5116f5c45946))
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
