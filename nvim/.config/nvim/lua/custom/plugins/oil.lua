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

local function open_in_adjacent_window()
	local oil = require("oil")
	local entry = oil.get_cursor_entry()
	if not entry then
		return
	end

	-- Directories: navigate within oil pane
	if entry.type == "directory" then
		oil.select()
		return
	end

	local dir = oil.get_current_dir()
	if not dir then
		return
	end
	local path = dir .. entry.name

	-- Find first non-oil window in the tabpage
	local oil_win = vim.api.nvim_get_current_win()
	local target_win = nil
	for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
		if win ~= oil_win then
			local buf = vim.api.nvim_win_get_buf(win)
			if vim.bo[buf].filetype ~= "oil" then
				target_win = win
				break
			end
		end
	end

	if target_win then
		vim.api.nvim_set_current_win(target_win)
		vim.cmd("edit " .. vim.fn.fnameescape(path))
	else
		vim.cmd("vsplit " .. vim.fn.fnameescape(path))
	end
end

require("oil").setup({
	delete_to_trash = true,
	skip_confirm_for_simple_edits = true,
	keymaps = {
		["<CR>"] = { callback = open_in_adjacent_window, desc = "Open in adjacent window" },
		["<C-h>"] = false, -- let smart-splits handle window navigation
		["<C-l>"] = false, -- let smart-splits handle window navigation
		["gr"] = "actions.refresh", -- remap refresh off <C-l>
	},
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

local function toggle_oil_sidebar()
	for _, win in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
		local buf = vim.api.nvim_win_get_buf(win)
		if vim.bo[buf].filetype == "oil" then
			vim.api.nvim_win_close(win, true)
			return
		end
	end
	vim.cmd("leftabove vsplit")
	require("oil").open()
	vim.api.nvim_win_set_width(0, 40)
	vim.wo.winfixwidth = true
end

vim.keymap.set("n", "<leader>e", toggle_oil_sidebar, { desc = "Toggle Oil sidebar" })
