-- Minimal Neovim 0.11+ config for the Sygnal language server (I-2), used by run.sh.
-- The server command is wrapped in lsp-tap.mjs when SYGNAL_TAP_LOG is set, to capture the traffic.
-- Env: SYGNAL_SETTINGS = 'strict' (settings.sygnal.strict = true, answered on workspace/configuration),
--      'init' (init_options = { strict = true }), anything else: no editor settings.
local cmd = { 'npx', '--no-install', 'sygnal-check', 'lsp' }
local tap = os.getenv('SYGNAL_TAP_LOG')
if tap and tap ~= '' then
  cmd = vim.list_extend({ 'node', os.getenv('SYGNAL_TAP'), tap }, cmd)
end

local mode = os.getenv('SYGNAL_SETTINGS') or ''
local config = {
  cmd = cmd,
  filetypes = { 'javascript', 'javascriptreact', 'typescript', 'typescriptreact' },
  root_markers = { 'sygnal-check.config.json', 'package.json', '.git' },
}
if mode == 'strict' then config.settings = { sygnal = { strict = true } } end
if mode == 'init' then config.init_options = { strict = true } end

vim.lsp.config('sygnal', config)
vim.lsp.enable('sygnal')
