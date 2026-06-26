require("octo").setup({
	use_local_fs = false,
	enable_builtin = true,
	default_remote = { "upstream", "origin" },
	picker = "telescope",
	picker_config = {
		use_emojis = true,
	},
	comment_icon = "▎",
	right_bubble_delimiter = "",
	left_bubble_delimiter = "",
	snippet_context_lines = 4,
	timeout = 5000,
	default_merge_method = "commit",
	colors = {
		white = "#ffffff",
		grey = "#2A354C",
		black = "#000000",
		red = "#ed8796",
		dark_red = "#f38ba8",
		green = "#a6da95",
		dark_green = "#a6e3a1",
		yellow = "#eed49f",
		dark_yellow = "#fab387",
		blue = "#8aadf4",
		dark_blue = "#89b4fa",
		purple = "#c6a0f6",
	},
	mappings_disable_default = false,
	mappings = {},
})

-- Register Telescope extension
require("telescope").load_extension("octo")

-- Global keymaps
vim.keymap.set("n", "<leader>oi", "<cmd>Octo issue list<cr>", { desc = "[O]cto [I]ssues" })
vim.keymap.set("n", "<leader>op", "<cmd>Octo pr list<cr>", { desc = "[O]cto [P]Rs" })
vim.keymap.set("n", "<leader>or", "<cmd>Octo review start<cr>", { desc = "[O]cto [R]eview start" })
vim.keymap.set("n", "<leader>os", "<cmd>Octo search<cr>", { desc = "[O]cto [S]earch" })
