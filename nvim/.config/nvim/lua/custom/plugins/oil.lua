if vim.g.vscode then
	return
end

local function parse_output(proc)
	local result = proc:wait()
	local ret = {}
	if result.code == 0 then
		for raw_line in vim.gsplit(result.stdout, "\n", { plain = true, trimempty = true }) do
			local line = raw_line:gsub('^"(.*)"$', "%1")
			table.insert(ret, line)
		end
	end
	return ret
end

local git_status = setmetatable({}, {
	__index = function(self, key)
		local ignore_proc = vim.system(
			{ "git", "ls-files", "--ignored", "--exclude-standard", "--others", "--directory" },
			{ cwd = key, text = true }
		)
		local tracked_proc = vim.system(
			{ "git", "ls-tree", "HEAD", "--name-only" },
			{ cwd = key, text = true }
		)
		local ret = { ignored = {}, tracked = {} }
		for _, path in ipairs(parse_output(ignore_proc)) do
			path = path:gsub("/$", "")
			ret.ignored[path] = true
		end
		for _, path in ipairs(parse_output(tracked_proc)) do
			ret.tracked[path] = true
		end
		rawset(self, key, ret)
		return ret
	end,
})

require("oil").setup({
	delete_to_trash = true,
	skip_confirm_for_simple_edits = true,
	view_options = {
		show_hidden = true,
		is_hidden_file = function(name, bufnr)
			local dir = require("oil").get_current_dir(bufnr)
			local is_dotfile = vim.startswith(name, ".") and name ~= ".."
			if not dir then
				return is_dotfile
			end
			if is_dotfile then
				return not git_status[dir].tracked[name]
			else
				return git_status[dir].ignored[name]
			end
		end,
	},
	git = {
		add = function(_path)
			return true
		end,
		mv = function(_src_path, _dest_path)
			return true
		end,
		rm = function(_path)
			return true
		end,
	},
})

vim.keymap.set("n", "<leader>e", "<cmd>Oil<CR>", { desc = "Toggle Oil" })
