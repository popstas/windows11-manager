-- WezTerm для окон claude-wt на ноутбуке nb. Выкатывается в
-- %USERPROFILE%\.wezterm.lua скриптом data/scripts/deploy-pc.sh.
--
-- Всё, чего здесь нет, — дефолты WezTerm (решение Стаса 15.11: минимум своего
-- Lua, к дефолтам он переучивается). Здесь только то, без чего ломаются
-- windows11-manager, AHK (main-popstas.ahk) или цвета проектов.
--
-- Проверено на WezTerm 20240203-110809-5046fc22.
local wezterm = require 'wezterm'
local act = wezterm.action

-- Схемы из wt. Argonaut и Tango Light берутся встроенные. У встроенных
-- Solarized Dark, OneHalfDark и Material (base16) один из чёрных равен фону,
-- и тусклый текст (ANSI 90) пропадает; Ottosson встроенного нет. Встроенная
-- «Material» светлая, своя её перекрывает.
local schemes = {
  ['Solarized Dark'] = {
    foreground = '#839496', background = '#002B36', cursor_bg = '#FFFFFF', cursor_border = '#FFFFFF',
    ansi = { '#002B36', '#DC322F', '#859900', '#B58900', '#268BD2', '#D33682', '#2AA198', '#EEE8D5' },
    brights = { '#073642', '#CB4B16', '#586E75', '#657B83', '#839496', '#6C71C4', '#93A1A1', '#FDF6E3' },
  },
  ['Material'] = {
    foreground = '#EEFFFF', background = '#263238', cursor_bg = '#FFFFFF', cursor_border = '#FFFFFF',
    ansi = { '#000000', '#F07178', '#C3E88D', '#FFCB6B', '#82AAFF', '#C792EA', '#89DDFF', '#FFFFFF' },
    brights = { '#546E7A', '#F07178', '#C3E88D', '#FFCB6B', '#82AAFF', '#C792EA', '#89DDFF', '#FFFFFF' },
  },
  ['One Half Dark'] = {
    foreground = '#DCDFE4', background = '#282C34', cursor_bg = '#FFFFFF', cursor_border = '#FFFFFF',
    ansi = { '#282C34', '#E06C75', '#98C379', '#E5C07B', '#61AFEF', '#C678DD', '#56B6C2', '#DCDFE4' },
    brights = { '#5A6374', '#E06C75', '#98C379', '#E5C07B', '#61AFEF', '#C678DD', '#56B6C2', '#DCDFE4' },
  },
  ['Ottosson'] = {
    foreground = '#bebebe', background = '#000000', cursor_bg = '#ffffff', cursor_border = '#ffffff',
    ansi = { '#000000', '#be2c21', '#3fae3a', '#be9a4a', '#204dbe', '#bb54be', '#00a7b2', '#bebebe' },
    brights = { '#808080', '#ff3e30', '#58ea51', '#ffc944', '#2f6aff', '#fc74ff', '#00e1f0', '#ffffff' },
  },
}
local DEFAULT_SCHEME = 'Solarized Dark'

-- Цвет проекта: шаблоны launch* в конфиге windows11-manager печатают
-- OSC 1337 SetUserVar=wt_profile=<base64 имени профиля wt>. Чего нет в
-- таблице, — DEFAULT_SCHEME.
local PROFILE_SCHEMES = {
  ['home'] = 'Argonaut',
  ['ExpertizeMe'] = 'Ottosson',
  ['home-project'] = 'Solarized Dark',
  ['work-project'] = 'Material',
  ['reaper-project'] = 'One Half Dark',
}
-- Только текущее окно, чужие ключи overrides не теряются.
local function set_scheme(window, scheme)
  local overrides = window:get_config_overrides() or {}
  overrides.color_scheme = scheme
  window:set_config_overrides(overrides)
end
wezterm.on('user-var-changed', function(window, _, name, value)
  if name == 'wt_profile' then
    set_scheme(window, PROFILE_SCHEMES[value or ''] or DEFAULT_SCHEME)
  end
end)
local function theme(scheme)
  return wezterm.action_callback(function(window) set_scheme(window, scheme) end)
end

-- Заголовок окна = заголовок панели, без «[1/2]» и «[Z]» дефолта: по нему
-- windows11-manager сопоставляет окно с сессией, AHK ищет head-окна
-- (Win+Alt+T) и cwd сессии (Ctrl+Space).
wezterm.on('format-window-title', function(tab)
  return tab.active_pane.title
end)

-- Звонок своим звуком, как в wt (Стас 15.11: нужен). audible_bell умеет только
-- системный, поэтому звук играет отдельный процесс. Режим — флаги в профиле,
-- их кладёт и снимает кнопка в статуслайне ccfzf-picker (Стас 24.11 и 25.11),
-- имена — контракт с wezterm_bell.rs пикера:
--   ~/.wezterm-bell-off           — молчат все;
--   ~/.wezterm-bell-children-off  — молчат дочерние сессии (у кого есть head);
--   нет ни одного                 — звенят все.
-- Какое окно дочернее, пишет служба windows11-manager в ~/.wezterm-bell-children
-- (src/claude-wt/bell-children-helpers.js): первая строка — заголовок со
-- временем, дальше ключ заголовка окна на строку. Нет файла, протух, не
-- разобрался, упало что угодно — звенит (лишний звонок ребёнка лучше
-- замолчавшего head).
-- Второй список того же формата — ~/.wezterm-bell-quiet (заголовок
-- «# wezterm-bell-quiet <unix-с>»): окна сессий с тихим концом хода (head,
-- ребёнок которого работает, — Стасу делать нечего; решение 26.11). Его пишет
-- служба кнопок панели задач (src/mqtt/taskbar.js), и молчит такое окно в любом
-- режиме. Несвежий или битый — звенит.
local BELL_SOUND = 'C:/profiles/sounds/mixkit-sci-fi-click-900.wav'
local BELL_OFF = wezterm.home_dir .. '/.wezterm-bell-off'
local BELL_CHILDREN_OFF = wezterm.home_dir .. '/.wezterm-bell-children-off'
local BELL_CHILDREN = wezterm.home_dir .. '/.wezterm-bell-children'
local BELL_CHILDREN_HEADER = '# wezterm-bell-children'
local BELL_QUIET = wezterm.home_dir .. '/.wezterm-bell-quiet'
local BELL_QUIET_HEADER = '# wezterm-bell-quiet'
-- Секунд верим списку (обоим): служба переписывает их не реже раза в минуту.
local BELL_CHILDREN_TTL = 300
-- Глифы статуса в начале заголовка, как GLYPH_RANGES в bell-children-helpers.js.
local BELL_GLYPHS = {
  { 0x00B7, 0x00B7 },
  { 0x2190, 0x2BFF },
  { 0x1F000, 0x1FAFF },
}
local function exists(path)
  local f = io.open(path); if f then f:close(); return true end
  return false
end
local function is_glyph(cp)
  for _, r in ipairs(BELL_GLYPHS) do
    if cp >= r[1] and cp <= r[2] then return true end
  end
  return false
end
local function trim(s) return (s:gsub('^%s+', ''):gsub('%s+$', '')) end
-- Ключ заголовка — bellTitleKey в bell-children-helpers.js, фикстуры общие
-- (wezterm/bell-title-cases.json): без [Z] и [i/n] WezTerm, приставки zellij
-- «сессия | » и глифа Claude Code с пробелами за ним.
local function bell_key(title)
  if type(title) ~= 'string' then return '' end
  local s = trim(title)
  s = (s:gsub('^%[Z%] ', '', 1))
  s = (s:gsub('^%[%d+/%d+%] ', '', 1))
  s = (s:gsub('^[^%s|]+ | ', '', 1))
  local i = 1
  while i <= #s do
    local ok, cp = pcall(utf8.codepoint, s, i)
    if not ok or not is_glyph(cp) then break end
    i = utf8.offset(s, 2, i)
  end
  if i > 1 then
    local ws = s:match('^%s+', i)
    if ws then s = s:sub(i + #ws) end
  end
  return trim(s)
end
-- Ключи списка (детей или тихих) или nil, если ему верить нельзя.
local function bell_list(path, header)
  local f = io.open(path)
  if not f then return nil end
  local head = f:read('l') or ''
  local prefix = header .. ' '
  local stamp = head:sub(1, #prefix) == prefix and tonumber(head:sub(#prefix + 1)) or nil
  if not stamp or math.abs(os.time() - stamp) > BELL_CHILDREN_TTL then f:close(); return nil end
  local keys = {}
  for line in f:lines() do
    line = trim(line)
    if line ~= '' then keys[line] = true end
  end
  f:close()
  return keys
end
-- Окно в списке? Любой сбой — нет (звенит).
local function in_list(pane, path, header)
  local ok, hit = pcall(function()
    local keys = bell_list(path, header)
    if not keys then return false end
    local key = bell_key(pane:get_title())
    return key ~= '' and keys[key] == true
  end)
  return ok and hit
end
local function bell_muted(pane)
  if exists(BELL_OFF) then return true, 'off' end
  if in_list(pane, BELL_QUIET, BELL_QUIET_HEADER) then return true, 'quiet' end
  if not exists(BELL_CHILDREN_OFF) then return false, 'on' end
  if in_list(pane, BELL_CHILDREN, BELL_CHILDREN_HEADER) then return true, 'child' end
  return false, 'no children'
end
wezterm.on('bell', function(_, pane)
  local muted, why = bell_muted(pane)
  -- Строка на звонок в журнал WezTerm: по ней сверяется, когда Claude Code
  -- звонит (конец хода или «waiting for your input» через минуту) и кто глушит.
  local got, key = pcall(function() return bell_key(pane:get_title()) end)
  pcall(wezterm.log_info, 'bell ' .. (muted and 'mute' or 'play') .. ' (' .. why .. '): ' .. (got and key or '?'))
  if muted then return end
  wezterm.background_child_process {
    'powershell.exe', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    "(New-Object Media.SoundPlayer '" .. BELL_SOUND .. "').PlaySync()",
  }
end)

local config = wezterm.config_builder()
config.color_schemes = schemes
config.color_scheme = DEFAULT_SCHEME
config.font = wezterm.font 'DejaVuSansM Nerd Font Mono'
config.font_size = 14
config.audible_bell = 'Disabled'
-- Немигающая черта между знаками, как в wt (Стас 16.11). Дефолтный блок
-- закрашивал символ под собой цветом курсора схемы (у Argonaut красный).
config.default_cursor_style = 'SteadyBar'
-- Модель «одна сессия = одно окно»: вкладок нет, полоса вкладок не нужна.
config.hide_tab_bar_if_only_one_tab = true
-- Окно с упавшим ssh остаётся открытым, видно ошибку; w11m и пикер закрывают
-- окна без диалога.
config.exit_behavior = 'CloseOnCleanExit'
config.window_close_confirmation = 'NeverPrompt'
-- Привязки по физическим клавишам: иначе в ru-раскладке Alt+Shift+L приходит
-- как Alt+Shift+Д и не совпадает, молчат темы и вставка.
config.key_map_preference = 'Physical'
-- Ctrl+Enter, Ctrl+Space, Ctrl+Q, Alt+Q и Ctrl+Alt+* перехватывает AHK.
config.keys = {
  -- Перевод строки в Claude (ESC+CR = Alt+Enter); его же шлёт AHK Ctrl+Q/Alt+Q.
  { key = 'Enter', mods = 'SHIFT', action = act.SendString '\x1b\r' },
  -- AHK Ctrl+Alt+V вставляет путь скриншота через ^v.
  { key = 'v', mods = 'CTRL', action = act.PasteFrom 'Clipboard' },
  -- Темы текущего окна (Стас 15.11).
  { key = 'S', mods = 'ALT|SHIFT', action = theme 'Solarized Dark' },
  { key = 'W', mods = 'ALT|SHIFT', action = theme 'Material' },
  { key = 'L', mods = 'ALT|SHIFT', action = theme 'Builtin Tango Light' },
}
return config
