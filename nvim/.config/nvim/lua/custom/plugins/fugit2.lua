if vim.g.vscode then
	return
end
require("fugit2").setup({
	width = 70,
	external_diffview = true,
	libgit2_path = "/opt/homebrew/lib/libgit2.dylib",
})

vim.keymap.set("n", "<leader>F", "<cmd>Fugit2<cr>", { desc = "Fugit2" })
