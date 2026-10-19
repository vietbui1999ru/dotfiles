if vim.g.vscode then
	return
end
-- capabilities and the incremental-sync workaround come from vim.lsp.config("*") in init.lua
vim.lsp.config("ocamllsp", {
	settings = {
		ocamllsp = {
			extendedHover = true,
			codelens = { enable = true },
			diagnostics = { merlin = true },
		},
	},
})
vim.lsp.enable("ocamllsp")
