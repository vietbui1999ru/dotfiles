return {
	"3rd/diagram.nvim",
	dependencies = {
		{
			"3rd/image.nvim",
			opts = {
				events = {
					render_buffer = {},
					clear_buffer = { "BufLeave" },
				},
				renderer_options = {
					mermaid = {
						theme = "dark",
						scale = 2,
					},
				},
			},
		},
	},
	config = function()
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
				plantuml = {
					charset = "utf-8",
				},
				d2 = {
					theme_id = 1,
				},
				gnuplot = {
					theme = "dark",
					size = "800,600",
				},
			},
		})
	end,
	keys = {
		{
			"K",
			function()
				require("diagram").show_diagram_hover()
			end,
			mode = "n",
			cond = function()
				return vim.bo.filetype == "markdown"
			end,
			desc = "Show diagram in new tab",
		},
	},
}
