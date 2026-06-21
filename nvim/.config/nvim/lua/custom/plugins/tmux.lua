if vim.g.vscode then
	return
end
require("tmux").setup({
	-- vim-tmux-navigator handles C-hjkl; tmux.nvim owns copy-sync only
	navigation = { enable_default_keybindings = false },
	resize = { enable_default_keybindings = false },
	swap = { enable_default_keybindings = false },
})
