-- The I-2 Neovim checks, run by run.sh as `nvim --headless -u init.lua src/C.jsx +'luafile test.lua'`.
-- Writes a JSON report to $SYGNAL_RESULT and quits (which exercises shutdown/exit).
local out = { steps = {} }
local function rec(name, ok, detail)
  table.insert(out.steps, { name = name, ok = ok and true or false, detail = detail })
end
local function finish()
  local f = assert(io.open(os.getenv('SYGNAL_RESULT'), 'w'))
  f:write(vim.json.encode(out))
  f:close()
  vim.cmd('qall!')
end

local ok, err = xpcall(function()
  local root = vim.fn.getcwd()
  local mode = os.getenv('SYGNAL_SETTINGS') or ''
  out.mode = mode
  out.nvim = tostring(vim.version())
  local c_buf = vim.api.nvim_get_current_buf()

  -- 1. the server starts and attaches
  local client
  local started = vim.wait(10000, function()
    client = vim.lsp.get_clients({ bufnr = c_buf, name = 'sygnal' })[1]
    return client ~= nil and client.initialized
  end, 20)
  rec('server starts and attaches', started, client and { root_dir = client.root_dir, workspace_folders = client.workspace_folders })
  if not started then return end

  -- 2. diagnostics on C.jsx
  local diags
  local got = vim.wait(10000, function()
    diags = vim.diagnostic.get(c_buf)
    return #diags >= 3
  end, 20)
  local list = {}
  for _, d in ipairs(diags) do
    local lsp = d.user_data and d.user_data.lsp or {}
    table.insert(list, {
      code = d.code, lnum = d.lnum + 1, col = d.col + 1, end_lnum = d.end_lnum + 1, end_col = d.end_col + 1,
      severity = d.severity, source = d.source, message = d.message,
      codeDescription = lsp.codeDescription, relatedInformation = lsp.relatedInformation,
      has_data = lsp.data ~= nil,
    })
  end
  table.sort(list, function(a, b) return a.lnum < b.lnum or (a.lnum == b.lnum and a.col < b.col) end)
  rec('diagnostics on C.jsx', got and #list == 3, list)

  -- 3. strict setting reaching the server: SYG505 on the unopened E.jsx?
  local e_path = root .. '/src/E.jsx'
  local function e_codes()
    local codes = {}
    for _, d in ipairs(vim.diagnostic.get()) do
      if vim.api.nvim_buf_get_name(d.bufnr) == e_path then table.insert(codes, d.code) end
    end
    table.sort(codes)
    return codes
  end
  vim.wait(3000, function() return #e_codes() > 0 end, 20)
  vim.wait(500)
  rec('unopened E.jsx findings (strict test)', true, { mode = mode, codes = e_codes() })

  -- 4. hover on SYG110 (line 5, the '.incc' string), and the rendered float
  local syg110
  for _, d in ipairs(diags) do if d.code == 'SYG110' then syg110 = d end end
  vim.api.nvim_win_set_cursor(0, { syg110.lnum + 1, syg110.col + 1 })
  local params = vim.lsp.util.make_position_params(0, client.offset_encoding)
  local res = vim.lsp.buf_request_sync(c_buf, 'textDocument/hover', params, 5000)
  local hover = res and res[client.id] and res[client.id].result
  rec('hover result', hover ~= nil, hover and { kind = hover.contents.kind, head = hover.contents.value:sub(1, 160) })
  vim.lsp.buf.hover()
  local float_info
  vim.wait(3000, function()
    for _, w in ipairs(vim.api.nvim_list_wins()) do
      if vim.api.nvim_win_get_config(w).relative ~= '' then
        local b = vim.api.nvim_win_get_buf(w)
        float_info = { filetype = vim.bo[b].filetype, lines = vim.list_slice(vim.api.nvim_buf_get_lines(b, 0, -1, false), 1, 6) }
        return true
      end
    end
    return false
  end, 20)
  rec('hover float (vim.lsp.buf.hover)', float_info ~= nil and float_info.filetype == 'markdown', float_info)
  for _, w in ipairs(vim.api.nvim_list_wins()) do
    if vim.api.nvim_win_get_config(w).relative ~= '' then vim.api.nvim_win_close(w, true) end
  end

  -- 5. the diagnostic float (shows relatedInformation, if any)
  local _, fwin = vim.diagnostic.open_float({ scope = 'buffer' })
  if fwin then
    local b = vim.api.nvim_win_get_buf(fwin)
    rec('diagnostic float (buffer scope)', true, vim.api.nvim_buf_get_lines(b, 0, -1, false))
    vim.api.nvim_win_close(fwin, true)
  end

  -- 6. code actions at SYG110: the list, as vim.lsp.buf.code_action builds its context
  local ca_params = vim.lsp.util.make_range_params(0, client.offset_encoding)
  ca_params.context = { diagnostics = {}, triggerKind = 1 }
  for _, d in ipairs(vim.diagnostic.get(c_buf, { lnum = syg110.lnum })) do
    if d.user_data and d.user_data.lsp then table.insert(ca_params.context.diagnostics, d.user_data.lsp) end
  end
  local car = vim.lsp.buf_request_sync(c_buf, 'textDocument/codeAction', ca_params, 5000)
  local titles = {}
  for _, a in ipairs((car and car[client.id] and car[client.id].result) or {}) do
    table.insert(titles, { title = a.title, kind = a.kind, isPreferred = a.isPreferred })
  end
  rec('code actions at SYG110', #titles > 0, titles)

  -- 7. apply the quick fix through the real UI path (vim.lsp.buf.code_action with apply = true)
  vim.lsp.buf.code_action({
    filter = function(a) return a.title:find("'.inc'", 1, true) ~= nil end,
    apply = true,
  })
  local fixed = vim.wait(3000, function()
    return vim.api.nvim_buf_get_lines(c_buf, 4, 5, false)[1]:find("'.inc'", 1, true) ~= nil
  end, 20)
  local cleared = vim.wait(3000, function()
    for _, d in ipairs(vim.diagnostic.get(c_buf)) do if d.code == 'SYG110' then return false end end
    return true
  end, 20)
  rec('quick fix applies; SYG110 clears after the unsaved change', fixed and cleared,
    { line5 = vim.api.nvim_buf_get_lines(c_buf, 4, 5, false)[1], remaining = vim.tbl_map(function(d) return d.code end, vim.diagnostic.get(c_buf)) })

  -- 8. the suppress action on SYG102 (line 6)
  local syg102
  for _, d in ipairs(vim.diagnostic.get(c_buf)) do if d.code == 'SYG102' then syg102 = d end end
  vim.api.nvim_win_set_cursor(0, { syg102.lnum + 1, syg102.col + 1 })
  vim.lsp.buf.code_action({
    filter = function(a) return a.title:find('Suppress SYG102', 1, true) ~= nil end,
    apply = true,
  })
  local suppressed = vim.wait(3000, function()
    return (vim.api.nvim_buf_get_lines(c_buf, syg102.lnum, syg102.lnum + 1, false)[1] or ''):find('sygnal-ignore-next-line SYG102', 1, true) ~= nil
  end, 20)
  local gone = vim.wait(3000, function()
    for _, d in ipairs(vim.diagnostic.get(c_buf)) do if d.code == 'SYG102' then return false end end
    return true
  end, 20)
  rec('suppress action inserts the comment; SYG102 clears', suppressed and gone,
    vim.api.nvim_buf_get_lines(c_buf, syg102.lnum, syg102.lnum + 2, false))

  -- 9. source.fixAll.sygnal on E.jsx (the emit() rewrite)
  vim.cmd('edit ' .. vim.fn.fnameescape(e_path))
  local e_buf = vim.api.nvim_get_current_buf()
  vim.wait(5000, function() return #vim.lsp.get_clients({ bufnr = e_buf, name = 'sygnal' }) > 0 end, 20)
  vim.wait(300)
  -- relatedInformation: the SYG105 near miss on line 7 points at F.jsx
  local e105
  for _, d in ipairs(vim.diagnostic.get(e_buf)) do if d.code == 'SYG105' then e105 = d end end
  if e105 then
    local _, rwin = vim.diagnostic.open_float({ scope = 'line', pos = e105.lnum })
    local lines = rwin and vim.api.nvim_buf_get_lines(vim.api.nvim_win_get_buf(rwin), 0, -1, false) or {}
    if rwin then vim.api.nvim_win_close(rwin, true) end
    rec('relatedInformation in the diagnostic float (SYG105 on E.jsx)',
      table.concat(lines, '\n'):find('F.jsx:', 1, true) ~= nil,
      { float = lines, related = e105.user_data.lsp.relatedInformation })
  else
    rec('relatedInformation in the diagnostic float (SYG105 on E.jsx)', false, 'no SYG105 on E.jsx')
  end
  vim.lsp.buf.code_action({ context = { only = { 'source.fixAll.sygnal' } }, apply = true })
  local fixall = vim.wait(5000, function()
    return table.concat(vim.api.nvim_buf_get_lines(e_buf, 0, -1, false), '\n'):find('event(', 1, true) ~= nil
  end, 20)
  rec('source.fixAll.sygnal applies (code_action with context.only)', fixall,
    vim.api.nvim_buf_get_lines(e_buf, 0, -1, false))
  vim.cmd('silent! undo')

  -- 10. a new file written on disk: didChangeWatchedFiles (registered dynamically on macOS)
  local d_path = root .. '/src/D.jsx'
  local f = assert(io.open(d_path, 'w'))
  f:write("function D() { return <div className=\"a\" /> }\nD.intent = ({ DOM }) => ({ GO: DOM.click('.b') })\nD.model = { GO: (s) => s }\nexport default D\n")
  f:close()
  local watched = vim.wait(8000, function()
    for _, d in ipairs(vim.diagnostic.get()) do
      if vim.api.nvim_buf_get_name(d.bufnr) == d_path then return true end
    end
    return false
  end, 50)
  rec('a file written on disk gets findings without opening it (watched files)', watched, nil)
  os.remove(d_path)
  local d_cleared = vim.wait(8000, function()
    for _, d in ipairs(vim.diagnostic.get()) do
      if vim.api.nvim_buf_get_name(d.bufnr) == d_path then return false end
    end
    return true
  end, 50)
  rec('deleting it clears them', d_cleared, nil)

  -- 11. a second workspace folder (vim.lsp.buf.add_workspace_folder → didChangeWorkspaceFolders)
  local b_root = os.getenv('SYGNAL_ROOT_B')
  if b_root and b_root ~= '' then
    vim.lsp.buf.add_workspace_folder(b_root)
    local b_c = b_root .. '/src/C.jsx'
    local multi = vim.wait(8000, function()
      for _, d in ipairs(vim.diagnostic.get()) do
        if vim.api.nvim_buf_get_name(d.bufnr) == b_c then return true end
      end
      return false
    end, 50)
    rec('added workspace folder gets its own findings', multi, client.workspace_folders)
  end

  -- 12. stop the client the way :lsp stop does (shutdown, then exit); the tap log records the server's exit
  client:stop()
  local stopped = vim.wait(5000, function() return client:is_stopped() end, 20)
  vim.wait(500)
  rec('client:stop() stops the server', stopped, nil)
end, debug.traceback)
if not ok then rec('error', false, err) end
finish()
