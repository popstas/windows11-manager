-- WezTerm для окон claude-wt на ноутбуке nb.
--
-- Выкатывается в %USERPROFILE%\.wezterm.lua скриптом data/scripts/deploy-pc.sh.
-- Машинные пути (звук звонка) — nb: конфиг только для неё.
--
-- Модель — «одна сессия = одно окно», вкладок и панелей нет. windows11-manager
-- узнаёт окно по заголовку, поэтому заголовок окна обязан быть ровно
-- заголовком панели (format-window-title ниже).
--
-- Цвет проекта приходит сигналом из удалённой команды: шаблоны launch* в
-- конфиге windows11-manager печатают OSC 1337 SetUserVar=wt_profile=<base64>,
-- где значение — имя профиля wt проекта ({profileB64}). Ловит его
-- user-var-changed. Windows Terminal эту последовательность игнорирует.
--
-- Проверено на WezTerm 20240203-110809-5046fc22.

local wezterm = require 'wezterm'
local act = wezterm.action

-- Схемы перенесены из Windows Terminal один в один: settings.json wt (Argonaut,
-- Material) и defaults.json wt 1.25 (Ottosson, One Half Dark, Solarized Dark,
-- Tango Light). У WezTerm одноимённые встроенные схемы другие: его «Material»
-- светлая, а Ottosson в 20240203 нет вовсе. Свои определения под теми же
-- именами перекрывают встроенные.
local function scheme(c)
  return {
    foreground = c.fg,
    background = c.bg,
    cursor_bg = c.cursor,
    cursor_border = c.cursor,
    selection_bg = c.selection,
    ansi = c.ansi,
    brights = c.brights,
  }
end

local schemes = {
  ['Argonaut'] = scheme {
    fg = '#FFFAF4', bg = '#0E1019', cursor = '#FF0018', selection = '#002A3B',
    ansi = { '#232323', '#FF000F', '#8CE10B', '#FFB900', '#008DF8', '#6D43A6', '#00D8EB', '#FFFFFF' },
    brights = { '#444444', '#FF2740', '#ABE15B', '#FFD242', '#0092FF', '#9A5FEB', '#67FFF0', '#FFFFFF' },
  },
  ['Material'] = scheme {
    fg = '#EEFFFF', bg = '#263238', cursor = '#FFFFFF', selection = '#FFFFFF',
    ansi = { '#000000', '#F07178', '#C3E88D', '#FFCB6B', '#82AAFF', '#C792EA', '#89DDFF', '#FFFFFF' },
    brights = { '#546E7A', '#F07178', '#C3E88D', '#FFCB6B', '#82AAFF', '#C792EA', '#89DDFF', '#FFFFFF' },
  },
  ['Ottosson'] = scheme {
    fg = '#bebebe', bg = '#000000', cursor = '#ffffff', selection = '#92a4fd',
    ansi = { '#000000', '#be2c21', '#3fae3a', '#be9a4a', '#204dbe', '#bb54be', '#00a7b2', '#bebebe' },
    brights = { '#808080', '#ff3e30', '#58ea51', '#ffc944', '#2f6aff', '#fc74ff', '#00e1f0', '#ffffff' },
  },
  ['One Half Dark'] = scheme {
    fg = '#DCDFE4', bg = '#282C34', cursor = '#FFFFFF',
    ansi = { '#282C34', '#E06C75', '#98C379', '#E5C07B', '#61AFEF', '#C678DD', '#56B6C2', '#DCDFE4' },
    brights = { '#5A6374', '#E06C75', '#98C379', '#E5C07B', '#61AFEF', '#C678DD', '#56B6C2', '#DCDFE4' },
  },
  ['Solarized Dark'] = scheme {
    fg = '#839496', bg = '#002B36', cursor = '#FFFFFF',
    ansi = { '#002B36', '#DC322F', '#859900', '#B58900', '#268BD2', '#D33682', '#2AA198', '#EEE8D5' },
    brights = { '#073642', '#CB4B16', '#586E75', '#657B83', '#839496', '#6C71C4', '#93A1A1', '#FDF6E3' },
  },
  ['Tango Light'] = scheme {
    fg = '#555753', bg = '#FFFFFF', cursor = '#000000', selection = '#141414',
    ansi = { '#000000', '#CC0000', '#4E9A06', '#C4A000', '#3465A4', '#75507B', '#06989A', '#D3D7CF' },
    brights = { '#555753', '#EF2929', '#8AE234', '#FCE94F', '#729FCF', '#AD7FA8', '#34E2E2', '#EEEEEC' },
  },
}

-- Вид окна: схема и прозрачность. Прозрачность — как у профилей wt (общая 90,
-- у home-project 60, у work-project 70). Светлая тема без прозрачности: она для
-- скриншотов таблиц, и просвечивающий фон там мешает.
local DEFAULT_LOOK = { scheme = 'Solarized Dark', opacity = 0.9 }
local THEMES = {
  solarized = DEFAULT_LOOK,
  material = { scheme = 'Material', opacity = 0.7 },
  light = { scheme = 'Tango Light', opacity = 1.0 },
}

-- Профиль wt проекта → вид окна. Чего нет в таблице (popstas, пусто,
-- незнакомое) — DEFAULT_LOOK.
local PROFILE_LOOKS = {
  ['home'] = { scheme = 'Argonaut', opacity = 0.9 },
  ['ExpertizeMe'] = { scheme = 'Ottosson', opacity = 0.9 },
  ['home-project'] = { scheme = 'Solarized Dark', opacity = 0.6 },
  ['work-project'] = THEMES.material,
  ['reaper-project'] = { scheme = 'One Half Dark', opacity = 0.9 },
}

-- Только текущее окно и без потери чужих ключей overrides.
local function apply_look(window, look)
  local overrides = window:get_config_overrides() or {}
  overrides.color_scheme = look.scheme
  overrides.window_background_opacity = look.opacity
  window:set_config_overrides(overrides)
end

wezterm.on('user-var-changed', function(window, pane, name, value)
  if name ~= 'wt_profile' then return end
  apply_look(window, PROFILE_LOOKS[value or ''] or DEFAULT_LOOK)
end)

-- Заголовок окна = заголовок активной панели, без «[1/2]», «[Z]» и имени
-- процесса: по нему windows11-manager сопоставляет окно с сессией, а AHK ищет
-- head-окна (Win+Alt+T) и cwd сессии (Ctrl+Space).
wezterm.on('format-window-title', function(tab)
  return tab.active_pane.title
end)

-- Звонок как в wt: свой звук. audible_bell умеет только системный, поэтому
-- звук играет отдельный процесс.
local BELL_SOUND = 'C:/profiles/sounds/mixkit-sci-fi-click-900.wav'
wezterm.on('bell', function()
  wezterm.background_child_process {
    'powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    "(New-Object Media.SoundPlayer '" .. BELL_SOUND .. "').PlaySync()",
  }
end)

local function theme_action(look)
  return wezterm.action_callback(function(window) apply_look(window, look) end)
end

-- Ctrl+C как в wt: при выделении копировать, иначе ^C в терминал.
local copy_or_interrupt = wezterm.action_callback(function(window, pane)
  if window:get_selection_text_for_pane(pane) ~= '' then
    window:perform_action(act.CopyTo 'Clipboard', pane)
    window:perform_action(act.ClearSelection, pane)
  else
    window:perform_action(act.SendKey { key = 'c', mods = 'CTRL' }, pane)
  end
end)

local config = wezterm.config_builder()

config.color_schemes = schemes
config.color_scheme = DEFAULT_LOOK.scheme
config.window_background_opacity = DEFAULT_LOOK.opacity

config.font = wezterm.font 'DejaVuSansM Nerd Font Mono'
config.font_size = 14
config.scrollback_lines = 10000
config.initial_cols = 95
config.initial_rows = 50
config.window_padding = { left = 5, right = 5, top = 5, bottom = 5 }
config.audible_bell = 'Disabled'

-- Окно, а не вкладка: w11m ловит новое окно по снимку hwnd.
config.prefer_to_spawn_tabs = false
config.hide_tab_bar_if_only_one_tab = true
-- Как closeOnExit: automatic у wt.
config.exit_behavior = 'CloseOnCleanExit'
-- w11m и пикер закрывают окна без диалога.
config.window_close_confirmation = 'NeverPrompt'

-- copyOnSelect: false, как в wt: выделение мышью остаётся выделением, в буфер
-- его кладёт Ctrl+C. По умолчанию WezTerm копирует на отпускании кнопки
-- (CompleteSelection), и PrimarySelection тут не спасает: на Windows
-- set_clipboard вид буфера не различает, это тот же системный буфер.
-- Поэтому все отпускания, что копируют по умолчанию (одиночный клик с
-- NONE/SHIFT/ALT/ALT|SHIFT, двойной и тройной), — Nop. SHIFT нужен для Claude:
-- он включает отчёт мыши, и выделять там приходится с Shift.
local function no_copy_on(streak, mods)
  return { event = { Up = { streak = streak, button = 'Left' } }, mods = mods, action = act.Nop }
end
config.mouse_bindings = {
  no_copy_on(1, 'NONE'),
  no_copy_on(1, 'SHIFT'),
  no_copy_on(1, 'ALT'),
  no_copy_on(1, 'ALT|SHIFT'),
  no_copy_on(2, 'NONE'),
  no_copy_on(3, 'NONE'),
  {
    event = { Up = { streak = 1, button = 'Left' } },
    mods = 'CTRL',
    action = act.OpenLinkAtMouseCursor,
  },
}

-- Привязки по физическим клавишам, как в wt. По умолчанию (Mapped) WezTerm
-- сверяет символ текущей раскладки: в русской Alt+Shift+L приходит как
-- Alt+Shift+Д и с key = 'L' не совпадает, и так же молчали Ctrl+V и темы.
-- Проверено на nb 15.11: в ru тема не менялась, в en менялась.
config.key_map_preference = 'Physical'

-- Ctrl+Enter, Ctrl+Space, Ctrl+Q, Alt+Q и Ctrl+Alt+* перехватывает AHK
-- (main-popstas.ahk): на них здесь ничего не вешать.
config.keys = {
  -- Перевод строки в Claude: ESC+CR, Claude читает его как Alt+Enter. Не
  -- enable_kitty_keyboard: в 20240203 он экспериментальный и меняет кодировку
  -- остальных клавиш. AHK шлёт Shift+Enter из Ctrl+Q.
  { key = 'Enter', mods = 'SHIFT', action = act.SendString '\x1b\r' },
  { key = 'c', mods = 'CTRL', action = copy_or_interrupt },
  -- Ctrl+Alt+V в AHK (картинка из буфера) вставляет путь через ^v.
  { key = 'v', mods = 'CTRL', action = act.PasteFrom 'Clipboard' },
  { key = 'F', mods = 'CTRL|SHIFT', action = act.Search 'CurrentSelectionOrEmptyString' },
  -- В wt — «выделить вывод последней команды». Без OSC 133 от удалённого шелла
  -- зон вывода нет, ближайшее — copy mode с выделением с клавиатуры.
  { key = 'G', mods = 'CTRL|SHIFT', action = act.ActivateCopyMode },
  { key = 'UpArrow', mods = 'CTRL|SHIFT', action = act.ScrollToPrompt(-1) },
  { key = 'DownArrow', mods = 'CTRL|SHIFT', action = act.ScrollToPrompt(1) },
  -- Перенос строк выкл/вкл — как sendInput в wt.
  { key = 'z', mods = 'ALT', action = act.SendString '\x1b[?7l' },
  { key = 'Z', mods = 'ALT|SHIFT', action = act.SendString '\x1b[?7h' },
  -- Темы текущего окна (Стас 15.11). Цвет проекта ставится один раз при
  -- открытии окна; после смены сессии в kiosk-окне его поправляют этими.
  { key = 'S', mods = 'ALT|SHIFT', action = theme_action(THEMES.solarized) },
  { key = 'W', mods = 'ALT|SHIFT', action = theme_action(THEMES.material) },
  { key = 'L', mods = 'ALT|SHIFT', action = theme_action(THEMES.light) },
}

return config
