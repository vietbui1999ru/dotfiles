if vim.g.vscode then
	return
end

require("hunk").setup({
	ui = {
		tree = { mode = "nested", width = 35, use_float = false },
	},
})
