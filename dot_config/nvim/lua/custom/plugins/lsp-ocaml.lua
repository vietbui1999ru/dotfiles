-- File: ~/.config/nvim/lua/plugins/lsp_ocaml.lua
return {
	"neovim/nvim-lspconfig",
	opts = function(_, opts)
		local lspconfig = require("lspconfig")
		local util = require("lspconfig.util")

		opts.servers = opts.servers or {}
		opts.servers.ocamllsp = {
			cmd = { "ocamllsp" },
			filetypes = { "ocaml", "reason" },
			root_dir = util.root_pattern("*.opam", "esy.json", "package.json", "dune-project", ".git"),
			capabilities = capabilities,
			settings = {
				ocamllsp = {
					extendedHover = true,
					codelens = { enable = true },
					diagnostics = { merlin = true },
				},
			},
		}
	end,
}
