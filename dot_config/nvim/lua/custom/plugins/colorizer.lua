return {
	"norcalli/nvim-colorizer.lua",
	config = function()
		require("colorizer").setup({
			"*", -- Enable for all filetypes
		}, {
			RGB = true, -- #361
			RRGGBB = true, -- #RRGGBB
			names = true, -- color names like Blue, Red,
			RRGGBBAA = true, -- #90932321
			rgb_fn = true, -- rgb() functions
			hsl_fn = true, -- hsl() functions
			css = true, -- enable all CSS features
			css_fn = true, -- enable all CSS functions
			mode = "background", -- display color behind text
			custom_patterns = {
				-- match 0xRRGGBB
				["0x%x%x%x%x%x%x"] = "hex",
				-- match 0xRRGGBBAA
				["0x%x%x%x%x%x%x%x%x"] = "hex",
			},
		})
	end,
}
