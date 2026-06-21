if vim.g.vscode then
	return
end
require("colorizer").setup({ "*" }, {
	RGB = true,
	RRGGBB = true,
	names = true,
	RRGGBBAA = true,
	rgb_fn = true,
	hsl_fn = true,
	css = true,
	css_fn = true,
	mode = "background",
	custom_patterns = {
		["0x%x%x%x%x%x%x"] = "hex",
		["0x%x%x%x%x%x%x%x%x"] = "hex",
	},
})
