if vim.g.vscode then
	return
end
local dap = require("dap")
local dapui = require("dapui")
require("nvim-dap-virtual-text").setup()

dapui.setup({
	layouts = {
		{
			elements = {
				{ id = "scopes", size = 0.25 },
				{ id = "breakpoints", size = 0.25 },
				{ id = "stacks", size = 0.25 },
			},
			size = 40,
			position = "left",
		},
		{
			elements = { "console" },
			size = 0.25,
			position = "bottom",
		},
	},
})

dap.listeners.after.event_initialized["dapui_config"] = function()
	dapui.open()
end
dap.listeners.before.event_terminated["dapui_config"] = function()
	dapui.close()
end
dap.listeners.before.event_exited["dapui_config"] = function()
	dapui.close()
end

dap.configurations.javascript = {
	{
		type = "firefox",
		name = "Firefox Launch",
		request = "launch",
		reattach = true,
		program = "${file}",
		cwd = "${workspaceFolder}",
		url = "http://localhost:3000",
		sourceMaps = true,
		webRoot = "${workspaceFolder}",
	},
	{
		type = "firefox",
		name = "Firefox Attach",
		request = "attach",
		reattach = true,
		url = "http://localhost:3000",
		webRoot = "${workspaceFolder}",
		sourceMaps = true,
	},
}
dap.configurations.typescript = dap.configurations.javascript
dap.configurations.typescriptreact = dap.configurations.javascript

dap.adapters.firefox = {
	type = "server",
	host = "localhost",
	port = 6000,
	executable = {
		command = "bun",
		args = {
			vim.fn.stdpath("data") .. "/mason/packages/firefox-debug-adapter/dist/adapter.bundle.js",
			"--server=6000",
		},
	},
}

vim.keymap.set("n", "<leader>dc", "<cmd>DapContinue<cr>", { desc = "DAP Continue" })
vim.keymap.set("n", "<leader>db", "<cmd>DapToggleBreakpoint<cr>", { desc = "DAP Breakpoint" })
vim.keymap.set("n", "<leader>dr", "<cmd>DapToggleRepl<cr>", { desc = "DAP REPL" })
vim.keymap.set("n", "<leader>du", "<cmd>DapUI<cr>", { desc = "DAP UI Toggle" })
