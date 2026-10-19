if vim.g.vscode then
	return
end
vim.keymap.set("n", "<M-h>", require("smart-splits").resize_left)
vim.keymap.set("n", "<M-j>", require("smart-splits").resize_down)
vim.keymap.set("n", "<M-k>", require("smart-splits").resize_up)
vim.keymap.set("n", "<M-l>", require("smart-splits").resize_right)
-- <C-hjkl> and <C-\> navigation is owned by vim-tmux-navigator
vim.keymap.set("n", "<leader><leader>h", require("smart-splits").swap_buf_left)
vim.keymap.set("n", "<leader><leader>j", require("smart-splits").swap_buf_down)
vim.keymap.set("n", "<leader><leader>k", require("smart-splits").swap_buf_up)
vim.keymap.set("n", "<leader><leader>l", require("smart-splits").swap_buf_right)
