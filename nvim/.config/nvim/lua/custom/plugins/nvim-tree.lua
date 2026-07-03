if vim.g.vscode then
	return
end

local function on_attach(bufnr)
	require("nvim-tree.api").config.mappings.default_on_attach(bufnr)
end

require("nvim-tree").setup({
	sort = { sorter = "case_sensitive" },
	view = { width = 40 },
	renderer = { group_empty = true },
	filters = { dotfiles = false, git_ignored = true },
	git = { enable = true },
	trash = { cmd = "trash", require_confirm = true },
	actions = {
		open_file = { window_picker = { enable = false } },
	},
	on_attach = on_attach,
})

vim.keymap.set("n", "<leader>e", "<cmd>NvimTreeToggle<cr>", { desc = "Toggle nvim-tree sidebar" })
