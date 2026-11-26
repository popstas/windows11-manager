-- Обвязка теста звонка (src/claude-wt/bell-lua.test.js): заглушка модуля
-- wezterm, настоящий wezterm.lua, обработчик 'bell' на каждую строку stdin.
-- Строка: <cmd>\31<ключ>\31<заголовок>. cmd = set — переписать список одним
-- ключом со свежим временем; keep — список не трогать. Заголовок !error —
-- панель, у которой get_title() падает. Ответ — play или mute на строку.
local wez_path, home = arg[1], arg[2]
local played = false
local handlers = {}
local any = setmetatable({}, { __index = function() return function() return {} end end })
package.loaded['wezterm'] = {
  home_dir = home,
  action = any,
  on = function(name, fn) handlers[name] = fn end,
  action_callback = function(fn) return fn end,
  background_child_process = function() played = true end,
  config_builder = function() return {} end,
  font = function(x) return x end,
  log_info = function() end,
}
dofile(wez_path)
for line in io.lines() do
  local cmd, key, title = line:match('^(%a+)\31(.-)\31(.*)$')
  if cmd == 'set' then
    local f = assert(io.open(home .. '/.wezterm-bell-children', 'w'))
    f:write('# wezterm-bell-children ', os.time(), '\n', key, '\n')
    f:close()
  end
  local pane = { get_title = function() if title == '!error' then error('boom') end; return title end }
  played = false
  handlers['bell']({}, pane)
  io.write(played and 'play' or 'mute', '\n')
end
