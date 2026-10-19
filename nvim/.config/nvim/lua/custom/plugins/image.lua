if vim.g.vscode then
	return
end
-- the kitty backend errors on load without a terminal (headless/piped runs),
-- which would abort the rest of init.lua
if vim.uv.guess_handle(1) ~= "tty" then
	return
end
require("image").setup({
	processor = "magick_cli",
	integrations = {
		markdown = { enabled = false },
	},
})
