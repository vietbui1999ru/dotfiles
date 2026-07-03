if vim.g.vscode then
	return
end

require("neogit").setup({
	kind = "split",
	integrations = { diffview = true },
	-- native fs-event watcher (fixed ~200ms debounce); no configurable interval upstream
	filewatcher = { enabled = true },
})

vim.keymap.set("n", "<leader>gg", require("neogit").open, { desc = "Neogit: status" })
