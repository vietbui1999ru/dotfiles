if vim.g.vscode then
	return
end
require("mcphub").setup({
	port = 37373,
	config = vim.fn.expand("~/.config/mcphub/servers.json"),
	on_ready = function()
		vim.notify("MCP Hub is online!")
	end,
})
