if vim.g.vscode then
	return
end

local plugin_file = vim.fn.expand("~/repos/DiffViewer/nvim/diffviewer.lua")
if vim.fn.filereadable(plugin_file) == 0 then
	return
end

-- DiffViewer ships a single file with no lua/ dir, so the rtp can't resolve it
package.preload.diffviewer = function()
	return dofile(plugin_file)
end

vim.api.nvim_create_autocmd("VimEnter", {
	once = true,
	callback = function()
		require("diffviewer").setup()
	end,
})
