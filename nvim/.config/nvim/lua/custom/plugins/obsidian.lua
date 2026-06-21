if vim.g.vscode then
	return
end
require("obsidian").setup({
	workspaces = {
		{
			name = "mainvault",
			path = "~/repos/Obsidian/",
		},
		{
			name = "homelab",
			path = "~/repos/project-for-learning/track_22_homelab/",
		},
		{
			name = "gitlab",
			path = "~/repos/VsCode/vietbui1999ru/CodePath/GitLabCorps/ai-corps-contribution-codepath-sp26/",
		},
	},
})
