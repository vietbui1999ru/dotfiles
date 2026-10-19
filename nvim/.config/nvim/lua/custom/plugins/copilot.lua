if vim.g.vscode then
	return
end
require("copilot").setup({
	suggestion = { enabled = false },
	panel = { enabled = false },
	-- copilot calls vim.lsp.start itself and can start before init.lua's
	-- vim.lsp.config("*") runs, so it needs its own copy of the workaround:
	-- nvim 0.12.x incremental sync assertion bug (sync.lua:136)
	server_opts_overrides = { flags = { allow_incremental_sync = false } },
})
