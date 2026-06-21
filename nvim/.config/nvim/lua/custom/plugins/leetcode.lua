if vim.g.vscode then
	return
end
require("leetcode").setup({
	lang = "python3",
	image_support = true,
})
