# next
- [ ] Нужно распределить функции по проектам:
  - ccfzf - получение списка fzf-marks, claude sessions, claude-wt, объединение в единый список
  - ccfzf-picker - gui выбора сессии claude из списка ccfzf
  - windows11-manager - слежение за окнами терминалов, связывание их с сессиями claude через список ccfzf, snapshots. Полностью завязан на windows, wt. picker может работать без него на macos. Экспорт в Home Assistant (перенести из windows-mqtt)
  - Перенести mqtt подписки из windows-mqtt, windows.js: autoplace, place, store, restore
  - windows-mqtt - полностью исключается из цепочки, все его функции управления окнами и claude sessions переносятся в windows11-manager, ccfzf-picker
  - ccfzf-picker ведёт себя по-разному в зависимости от того, запущен ли он на хосте с windows11-manager или нет. Если запущен на хосте с windows11-manager, то он открывает сессии через windows11-manager, если нет, то открывает сессии через mqtt. Это нужно потому что windows11-manager хранит маппинг проектов на профили wt

# future
- [ ] Сменить формат конфига на yml
- [ ] Добавить интерфейс http, дублирует mqtt
