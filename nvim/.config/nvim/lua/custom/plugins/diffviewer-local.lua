if vim.g.vscode then return end

local plugin_path = vim.fn.expand("~/repos/DiffViewer/nvim")
if vim.fn.isdirectory(plugin_path) == 0 then return end

vim.opt.rtp:prepend(plugin_path)

vim.api.nvim_create_autocmd("VimEnter", {
  once = true,
  callback = function()
    require("diffviewer").setup()
  end,
})
