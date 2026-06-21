if vim.g.vscode then
	return
end
require("diagram").setup({
	events = {
		render_buffer = { "InsertLeave", "BufWinEnter", "TextChanged" },
		clear_buffer = { "BufLeave" },
	},
	integrations = {
		require("diagram.integrations.markdown"),
	},
	renderer_options = {
		mermaid = {
			background = "transparent",
			theme = "forest",
			scale = 1,
		},
		plantuml = { charset = "utf-8" },
		d2 = { theme_id = 1 },
		gnuplot = { theme = "dark", size = "800,600" },
	},
})

vim.keymap.set("n", "<leader>dK", function()
	if vim.bo.filetype == "markdown" then
		require("diagram").show_diagram_hover()
	end
end, { desc = "Show diagram hover" })
