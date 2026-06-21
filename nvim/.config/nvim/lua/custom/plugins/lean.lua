vim.api.nvim_create_autocmd("FileType", {
	pattern = "lean",
	once = true,
	group = vim.api.nvim_create_augroup("pack-lean", { clear = true }),
	callback = function()
		require("lean").setup({ mappings = true })
	end,
})
