if vim.g.vscode then
	return
end
require("copilot").setup({
	suggestion = { enabled = false },
	panel = { enabled = false },
})
