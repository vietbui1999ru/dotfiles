if vim.g.vscode then
	return
end

require("neogit").setup({
	kind = "split",
	integrations = { diffview = true },
	filewatcher = { enabled = true, interval = 1000 },
})

vim.keymap.set("n", "<leader>gg", require("neogit").open, { desc = "Neogit: status" })
