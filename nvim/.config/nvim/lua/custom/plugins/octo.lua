if vim.g.vscode then
	return
end

require("octo").setup({
	use_local_fs = false,
	enable_builtin = true,
	default_remote = { "upstream", "origin" },
	ssh_aliases = {},
	picker = "telescope",
})

local k = vim.keymap.set

-- PRs
k("n", "<leader>opl", "<cmd>Octo pr list<cr>", { desc = "[O]cto [P]R [L]ist" })
k("n", "<leader>opc", "<cmd>Octo pr create<cr>", { desc = "[O]cto [P]R [C]reate" })
k("n", "<leader>opv", "<cmd>Octo pr view<cr>", { desc = "[O]cto [P]R [V]iew" })
k("n", "<leader>opm", "<cmd>Octo pr merge<cr>", { desc = "[O]cto [P]R [M]erge" })
k("n", "<leader>opC", "<cmd>Octo pr checks<cr>", { desc = "[O]cto [P]R [C]hecks" })
k("n", "<leader>opr", "<cmd>Octo pr review<cr>", { desc = "[O]cto [P]R [R]eview start" })

-- Issues
k("n", "<leader>oil", "<cmd>Octo issue list<cr>", { desc = "[O]cto [I]ssue [L]ist" })
k("n", "<leader>oic", "<cmd>Octo issue create<cr>", { desc = "[O]cto [I]ssue [C]reate" })
k("n", "<leader>oiv", "<cmd>Octo issue view<cr>", { desc = "[O]cto [I]ssue [V]iew" })

-- Comments
k("n", "<leader>oca", "<cmd>Octo comment add<cr>", { desc = "[O]cto [C]omment [A]dd" })
k("n", "<leader>ocd", "<cmd>Octo comment delete<cr>", { desc = "[O]cto [C]omment [D]elete" })

-- Reviews (buffer-local when in review context)
k("n", "<leader>orA", "<cmd>Octo review submit<cr>", { desc = "[O]cto [R]eview [A]pprove/submit" })
k("n", "<leader>orr", "<cmd>Octo review resume<cr>", { desc = "[O]cto [R]eview [R]esume" })
k("n", "<leader>ord", "<cmd>Octo review discard<cr>", { desc = "[O]cto [R]eview [D]iscard" })
