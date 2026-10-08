-- Windows adapter for Jev Keyboard. No network, subprocesses, or busy waiting.
local M = { processor = {}, filter = {} }
local states, sequence = {}, 0
local ACCEPTED, NOOP, F8 = 1, 2, 65477

local function read(path, limit)
  local f = io.open(path, 'rb')
  if not f then return nil end
  local data = f:read(limit + 1)
  f:close()
  if not data or #data > limit then return nil end
  return data
end

local function json(s)
  return '"' .. s:gsub('[%z\1-\31\\"]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
    return string.format('\\u%04x', c:byte())
  end) .. '"'
end

local function document(value)
  if value == 'pending' then return { quality = 'pending', stamp = '', text = '' } end
  local stamp, quality, hex = value:match('^JCTX1|([%d%-]+)|(%a+)|([0-9a-f]*)$')
  if not stamp or #stamp > 60 or #hex > 640 or #hex % 4 ~= 0
    or (quality ~= 'exact' and quality ~= 'unavailable' and quality ~= 'sensitive')
    or (quality ~= 'exact' and hex ~= '') then return { quality = 'unavailable', stamp = '', text = '' } end
  local chars, high = {}, nil
  for i = 1, #hex, 4 do
    local c = tonumber(hex:sub(i, i + 3), 16)
    if high then
      if c < 0xdc00 or c > 0xdfff then return nil end
      chars[#chars + 1] = utf8.char(0x10000 + (high - 0xd800) * 1024 + c - 0xdc00)
      high = nil
    elseif c >= 0xd800 and c <= 0xdbff then high = c
    elseif c >= 0xdc00 and c <= 0xdfff or c == 0 or c == 0xfffc
      or (c < 32 and c ~= 9 and c ~= 10 and c ~= 13) or c == 127 then return nil
    else chars[#chars + 1] = utf8.char(c) end
  end
  if high or #chars > 80 then return nil end
  return { quality = quality, stamp = stamp, text = table.concat(chars) }
end

local function info(state)
  local data = read(state.dir .. '/bridge.info', 512)
  if not data then return nil end
  local instance, token, mode, stamp = data:match('^JEVWIN1\n([a-f0-9]+)\n([a-f0-9]+)\n(%w+)\n(%d+)\n$')
  local age = stamp and os.time() - tonumber(stamp) or 100
  if not instance or #instance ~= 32 or #token ~= 64 or age < -2 or age > 5 then return nil end
  return { instance = instance, token = token, mode = mode }
end

local function cancel(state)
  if state.pending then
    os.remove(state.dir .. '/inbox/' .. state.pending.id .. '.json')
    os.remove(state.dir .. '/outbox/' .. state.pending.id .. '.res')
  end
  state.pending, state.applied, state.status = nil, nil, nil
end

local function acquire(env)
  local ctx = env.engine.context
  local id = ctx:get_property('jev_windows_session')
  if id == '' or not states[id] then
    sequence = sequence + 1
    id = tostring(os.time()) .. '_' .. tostring({}):gsub('[^%w]', '') .. '_' .. sequence
    ctx:set_property('jev_windows_session', id)
    local dir = env.engine.schema.config:get_string('jev_windows/runtime_dir')
    if not dir or dir == '' then dir = (os.getenv('LOCALAPPDATA') or '') .. '/RimeJev/runtime' end
    local count = env.engine.schema.config:get_int('menu/page_size') or 7
    states[id] = { id = id, refs = 0, serial = 0,
      dir = dir, count = math.max(2, math.min(count, 10)), enabled = false, context_apps = {} }
    local apps = env.engine.schema.config:get_list('jev_windows/context_apps')
    if apps then for i = 0, apps.size - 1 do
      local value = env.engine.schema.config:get_string('jev_windows/context_apps/@' .. i)
      if value then states[id].context_apps[value:lower()] = true end
    end end
  end
  env.state = states[id]
  env.state.refs = env.state.refs + 1
end

local function release(env)
  if not env.state then return end
  env.state.refs = env.state.refs - 1
  if env.state.refs == 0 then cancel(env.state); states[env.state.id] = nil end
  env.state = nil
end

local function clear(state)
  cancel(state)
  state.snapshot = nil
  state.attempted, state.paused = nil, nil
  state.context_suppressed = nil
end

local function settings(state)
  local value = read(state.dir .. '/preferences', 128)
  local enabled, context
  if value then enabled, context = value:match('^JEVPREF1\n([01])\n([01])\n$') end
  -- Explicit local consent is required before ordinary typing can send text.
  local on = enabled == '1'
  if state.enabled ~= on then clear(state); state.enabled = on end
  if state.use_context ~= nil and state.use_context ~= (context == '1') then clear(state) end
  state.use_context = context == '1'
end

local function toggle(state)
  settings(state)
  local path = state.dir .. '/preferences'
  local f = io.open(path .. '.tmp', 'wb')
  if not f then return end
  local written = f:write('JEVPREF1\n' .. (state.enabled and '0' or '1') .. '\n' .. (state.use_context and '1' or '0') .. '\n')
  local closed = f:close()
  if written and closed then os.remove(path) end
  if written and closed and os.rename(path .. '.tmp', path) then settings(state)
  else os.remove(path .. '.tmp') end
end

local function signature(snap, history)
  local parts = { snap.input, tostring(snap.caret), snap.preedit, history }
  for _, c in ipairs(snap.candidates) do
    parts[#parts + 1] = c.text
    parts[#parts + 1] = tostring(c.start)
    parts[#parts + 1] = tostring(c.finish)
  end
  for i, part in ipairs(parts) do parts[i] = #part .. ':' .. part end
  return table.concat(parts, '|')
end

local function first_page(ctx)
  if ctx.composition:empty() then return false end
  return (ctx.composition:back().selected_index or 0) == 0
end

local function refresh(ctx)
  ctx:refresh_non_confirmed_composition()
end

local function prepare(buffer, env)
  local state, ctx = env.state, env.engine.context
  if not state then return nil end
  settings(state)
  local app = ctx:get_property('client_app') .. ':' .. ctx:get_property('client_type')
  if state.app and state.app ~= app then clear(state) end
  state.app = app
  local snap = { input = ctx.input, caret = ctx.caret_pos,
    preedit = buffer[1] and buffer[1].preedit or ctx.input, candidates = {} }
  for _, c in ipairs(buffer) do
    snap.candidates[#snap.candidates + 1] = { text = c.text, start = c.start, finish = c._end }
  end
  local doc = document(ctx:get_property('jev_context'))
    or { quality = 'unavailable', stamp = '', text = '' }
  if not state.use_context or state.context_suppressed or not state.context_apps[ctx:get_property('client_app'):lower()] then
    doc.text = ''
    if doc.quality == 'exact' then doc.quality = 'unavailable' end
  end
  snap.document = doc
  snap.context = doc.quality == 'exact' and doc.text or ''
  snap.signature = signature(snap, snap.context) .. '|' .. doc.quality .. '|' .. doc.stamp
  if state.snapshot and state.snapshot.signature ~= snap.signature then cancel(state) end
  if state.applied and os.time() > state.applied.expires then cancel(state) end
  state.snapshot = snap
  return state
end

local function submit(state)
  local snap = state.snapshot
  local service = info(state)
  if not service then state.status = 'start service'; return end
  if service.mode == 'offline' then state.status = 'configure key'; return end
  state.serial = state.serial + 1
  local id = state.id .. '_' .. state.serial
  local candidates = {}
  for _, c in ipairs(snap.candidates) do
    candidates[#candidates + 1] = string.format('{"text":%s,"start":%d,"end":%d}', json(c.text), c.start, c.finish)
  end
  local body = string.format('{"protocol":1,"id":%s,"instance":%s,"token":%s,"createdAt":%d,"session":%s,"sequence":%d,"pinyin":%s,"caret":%d,"preedit":%s,"context":%s,"document":{"source":"tsf","quality":%s,"stamp":%s},"candidates":[%s]}',
    json(id), json(service.instance), json(service.token), os.time(), json(state.id), state.serial,
    json(snap.input), snap.caret, json(snap.preedit), json(snap.context), json(snap.document.quality), json(snap.document.stamp), table.concat(candidates, ','))
  if #body > 20000 then state.status = 'request too large'; return end
  local path = state.dir .. '/inbox/' .. id .. '.json'
  local f = io.open(path .. '.tmp', 'wb')
  if not f then state.status = 'IPC error'; return end
  local written = f:write(body)
  local closed = f:close()
  if not written or not closed or not os.rename(path .. '.tmp', path) then
    os.remove(path .. '.tmp'); state.status = 'IPC error'; return
  end
  state.pending = { id = id, instance = service.instance, signature = snap.signature, created = os.time() }
  state.status = 'pending'
end

local function consume(state, ctx, native)
  local p = state.pending
  if state.snapshot.document.stamp ~= '' and (not native
    or ctx:get_property('jev_context') ~= state.context_wire) then return end
  local service = info(state)
  if not service or service.instance ~= p.instance or os.time() - p.created > 12
    or os.time() < p.created or p.signature ~= state.snapshot.signature then
    cancel(state); state.status = 'expired'; return
  end
  local raw = read(state.dir .. '/outbox/' .. p.id .. '.res', 4096)
  if not raw then state.status = 'pending'; return end
  local rows = {}
  for line in raw:gmatch('([^\n]*)\n') do rows[#rows + 1] = line end
  local count = #state.snapshot.candidates
  local valid = raw:sub(-1) == '\n' and #rows == 8 and rows[1] == 'JEVWIN2'
    and rows[2] == p.id and rows[3] == p.instance and tonumber(rows[6]) == count
    and rows[8] == state.snapshot.document.stamp
  local expires = tonumber(rows[5])
  valid = valid and expires and expires >= os.time() and expires <= os.time() + 15
  local order, seen = {}, {}
  if valid and rows[4] == 'ok' then
    for value in rows[7]:gmatch('[^,]+') do
      local n = tonumber(value)
      if not n or n % 1 ~= 0 or n < 1 or n > count or seen[n] then valid = false; break end
      seen[n] = true; order[#order + 1] = n
    end
    valid = valid and #order == count
  end
  cancel(state)
  if not valid then state.status = 'invalid result'
  elseif rows[4] == 'ok' then state.applied = { order = order, expires = expires }; state.status = 'ranked'
  elseif rows[4] == 'abstain' then state.status = 'keep original'
  else state.status = rows[7]:match('^[A-Z_]+$') and rows[7] or 'service error' end
end

function M.processor.init(env)
  acquire(env)
  local state, ctx = env.state, env.engine.context
  env.commit = ctx.commit_notifier:connect(function()
    cancel(state)
    state.snapshot = nil
    state.attempted, state.paused = nil, nil
    state.context_suppressed = nil
  end)
  env.update = ctx.update_notifier:connect(function(c)
    if state.snapshot and (c.input ~= state.snapshot.input or c.caret_pos ~= state.snapshot.caret) then
      cancel(state); state.snapshot = nil
    end
  end)
  env.option = ctx.option_update_notifier:connect(function(_, name)
    if name == 'ascii_mode' then clear(state) end
  end)
  env.property = ctx.property_update_notifier:connect(function(c, name)
    if name == 'jev_context_query' then
      settings(state)
      local app = c:get_property('client_app'):lower()
      c:set_property('jev_context_consent', state.enabled and state.use_context
        and not state.context_suppressed and state.context_apps[app] and '1' or '0')
    elseif name == 'jev_context' then
      local wire = c:get_property(name)
      if wire ~= state.context_wire then
        cancel(state)
        state.snapshot, state.attempted = nil, nil
        state.context_wire, state.context_dirty = wire, true
      end
    elseif name == 'jev_focus_epoch' then
      clear(state)
    elseif name == 'jev_manual_selection' then
      cancel(state)
      state.paused = c.input
    elseif name == 'jev_refresh' then
      local success = pcall(function()
        settings(state)
        if state.context_dirty then
          state.context_dirty = nil
          refresh(c)
          c:set_property('jev_refresh_ack', c:get_property('jev_refresh'))
          return
        end
        if state.enabled and state.pending and state.snapshot and not state.paused
          and not c:get_option('ascii_mode') and first_page(c)
          and c.input == state.snapshot.input and c.caret_pos == state.snapshot.caret then
          consume(state, c, true)
          if not state.pending then
            refresh(c)
            c:set_property('jev_refresh_ack', c:get_property('jev_refresh'))
          end
        end
      end)
      if not success then clear(state) end
    end
  end)
end

function M.processor.fini(env)
  for _, name in ipairs({ 'commit', 'update', 'option', 'property' }) do
    if env[name] then env[name]:disconnect(); env[name] = nil end
  end
  release(env)
end

local function process(key, env)
  local state, ctx = env.state, env.engine.context
  if not state or key:release() then return NOOP end
  settings(state)
  local code = key.keycode
  if code == F8 and key:ctrl() and not key:alt() and not key:super() and not key:shift() then
    clear(state)
    state.context_suppressed = true
    if ctx:is_composing() then refresh(ctx) end
    return ACCEPTED
  end
  -- Explicit diagnostic refresh, not a synthetic/background keyboard event.
  if code == F8 and key:ctrl() and key:alt() and not key:super() and not key:shift() then
    if ctx:is_composing() and first_page(ctx) then refresh(ctx) end
    return ACCEPTED
  end
  if code == F8 and not key:ctrl() and not key:alt() and not key:super() and not key:shift()
    and not ctx:get_option('ascii_mode') then
    toggle(state)
    if ctx:is_composing() then refresh(ctx) end
    return ACCEPTED
  end
  -- Invalidate before navigation, so an old response cannot replace a manual choice.
  if code == 65307 or code == 65293 or key:super() or key:ctrl() or key:alt() then clear(state)
  elseif not ctx:is_composing() and (code == 65288 or code == 65535 or (code >= 65360 and code <= 65367)) then clear(state)
  elseif (code >= 65360 and code <= 65367) or code == 45 or code == 61 or code == 65289 then
    cancel(state); state.paused = ctx.input
  end
  -- Never apply a newly arrived response on Space, number selection or Enter.
  -- The displayed candidate, not an unseen replacement, must be committed.
  return NOOP
end

function M.processor.func(key, env)
  local ok, result = pcall(process, key, env)
  if ok then return result end
  if env.state then clear(env.state) end
  return NOOP
end

function M.filter.init(env) acquire(env) end
function M.filter.fini(env) release(env) end
function M.filter.func(input, env)
  local next_candidate, translation = input:iter()
  local buffer = {}
  while #buffer < (env.state and env.state.count or 7) do
    local c = next_candidate(translation)
    if not c then break end
    buffer[#buffer + 1] = c
  end
  local ok, state = pcall(prepare, buffer, env)
  if not ok then state = nil end
  if state and state.enabled then
    local ctx, snap = env.engine.context, state.snapshot
    -- The native timer is driven by this annotation even before a bridge
    -- request exists. Without it, capture waits forever for its own result.
    if snap.document.quality == 'pending' then state.status = 'pending' end
    if state.paused and state.paused ~= snap.input then state.paused = nil end
    if not state.paused and snap.document.quality ~= 'pending' and snap.document.quality ~= 'sensitive'
      and not ctx:get_option('ascii_mode') and first_page(ctx)
      and #snap.candidates >= 2 and #snap.input <= 80 and snap.input:match("^[a-z ']+$")
      and snap.caret == #snap.input then
      local handled = pcall(function()
        if state.pending then consume(state, ctx, false)
        elseif not state.applied and state.attempted ~= snap.signature then
          state.attempted = snap.signature
          submit(state)
        end
      end)
      if not handled then cancel(state); state.status = 'unavailable' end
    end
  end
  local order = state and state.applied and state.applied.order or nil
  for position = 1, #buffer do
    local c = buffer[order and order[position] or position]
    if position == 1 and state then
      local status = not state.enabled and 'off' or state.status or 'on'
      local made, shadow = pcall(ShadowCandidate, c, c.type, c.text, (c.comment or '') .. ' [Jev: ' .. status .. ']')
      if made then c = shadow end
    end
    yield(c)
  end
  -- Continue the SAME iterator: never lose, duplicate, or exhaust later pages.
  while true do
    local c = next_candidate(translation)
    if not c then break end
    yield(c)
  end
end

return M
