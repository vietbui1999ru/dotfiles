-- plugins.lua
return {
	{
		name = "amazonq",
		url = "https://github.com/awslabs/amazonq.nvim.git",
		opts = {
			ssoStartUrl = "https://view.awsapps.com/start", -- Authenticate with Amazon Q Free Tier
		},
		keymap = {
			chat = {
				open = "<leader>Qc", -- Q for Amazon Q
				close = "<leader>Qx",
				submit = "<leader>Qs",
			},
			code_generation = {
				open = "<leader>Qg",
				accept = "<leader>Qy",
				reject = "<leader>Qn",
			},
		},
	},
}
