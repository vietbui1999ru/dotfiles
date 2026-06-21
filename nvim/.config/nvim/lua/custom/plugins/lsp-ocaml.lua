if vim.g.vscode then
	return
end
vim.api.nvim_create_autocmd("FileType", {
	pattern = { "ocaml", "reason" },
	once = true,
	group = vim.api.nvim_create_augroup("pack-ocaml", { clear = true }),
	callback = function()
		require("lspconfig").ocamllsp.setup({
			capabilities = require("blink.cmp").get_lsp_capabilities(),
			-- workaround: nvim 0.12.x incremental sync assertion bug (sync.lua:136)
			flags = { allow_incremental_sync = false },
			settings = {
				ocamllsp = {
					extendedHover = true,
					codelens = { enable = true },
					diagnostics = { merlin = true },
				},
			},
		})
	end,
})
