-- lazy.nvim
return {
	"folke/noice.nvim",
	event = "VeryLazy",
	lsp = {
		override = {
			-- override the default lsp markdown formatter with Noice
			["vim.lsp.util.convert_input_to_markdown_lines"] = true,
			-- override the lsp markdown formatter with Noice
			["vim.lsp.util.stylize_markdown"] = true,
		},
		signature = {
			enabled = false,
			auto_open = {
				enabled = true,
				trigger = true, -- Automatically show signature help when typing
				lua = false, -- Disable for Lua files
				throttle = 50, -- Debounce time in ms
			},
		},
		hover = {
			enabled = false,
			silent = true, -- set to true to not show a message if hover is already showing
			view = nil, -- when nil, use defaults from documentation
			opts = {}, -- merged with defaults from documentation. See defaults below
		},
	},
	opts = {
		-- add any options here
	},
	dependencies = {
		-- if you lazy-load any plugin below, make sure to add proper `module="..."` entries
		"MunifTanjim/nui.nvim",
		-- OPTIONAL:
		--   `nvim-notify` is only needed, if you want to use the notification view.
		--   If not available, we use `mini` as the fallback
		-- "rcarriga/nvim-notify",
	},
}
