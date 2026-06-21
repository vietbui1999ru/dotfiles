if vim.g.vscode then
	return
end
require("image").setup({
	processor = "magick_cli",
	integrations = {
		markdown = { enabled = false },
	},
})
