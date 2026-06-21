if vim.g.vscode then
	return
end
require("noice").setup({
	lsp = {
		override = {
			["vim.lsp.util.convert_input_to_markdown_lines"] = true,
			["vim.lsp.util.stylize_markdown"] = true,
		},
		signature = { enabled = false },
		hover = { enabled = false },
	},
})
