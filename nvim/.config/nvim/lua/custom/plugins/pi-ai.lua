--- pi-ai.lua — lightweight Neovim ↔ Pi/OMP bridge (no CodeCompanion)
---
--- Cursor-like AI workflow without an editor chat plugin:
---   - export current file/selection/diagnostics to .pi/nvim-context.json and
---     ~/.cache/pi-nvim/context.json
---   - launch Pi or OMP in a terminal with that context attached as @file
---   - provide a stable handoff file that the Pi TUI neovim-cockpit extension
---     can read via /nvim-context or the nvim_context tool.
---
--- Keymaps:
---   <leader>aC  export current Neovim context
---   <leader>ap  queue a prompt to the active Pi session
---   <leader>aa  ask Pi about current file/selection in a terminal split
---   <leader>aA  ask OMP about current file/selection
---   <leader>ai  open Pi TUI in a terminal split
---   <leader>aO  open OMP TUI in a terminal split

if vim.g.vscode then
	return
end

local M = {}

local function git_root()
	local out = vim.fn.system({ "git", "rev-parse", "--show-toplevel" })
	if vim.v.shell_error == 0 and out and out ~= "" then
		return vim.fn.trim(out)
	end
	return vim.fn.getcwd()
end

local function relpath(path, root)
	if path:sub(1, #root) == root then
		local rel = path:sub(#root + 2)
		return rel ~= "" and rel or path
	end
	return path
end

local function selected_range()
	local mode = vim.fn.mode()
	if not mode:match("[vV\22]") then
		return nil
	end
	local l1 = vim.fn.line("v")
	local l2 = vim.fn.line(".")
	if l1 > l2 then
		l1, l2 = l2, l1
	end
	return l1, l2
end

local function clip_lines(lines, max_chars)
	max_chars = max_chars or 12000
	local text = table.concat(lines, "\n")
	if #text <= max_chars then
		return text, false
	end
	return text:sub(1, max_chars) .. "\n... [truncated]", true
end

local function severity_name(severity)
	local sev_map = {
		[vim.diagnostic.severity.ERROR] = "ERROR",
		[vim.diagnostic.severity.WARN] = "WARN",
		[vim.diagnostic.severity.INFO] = "INFO",
		[vim.diagnostic.severity.HINT] = "HINT",
	}
	return sev_map[severity] or "UNKNOWN"
end

local function diagnostic_snapshot(bufnr)
	local diagnostics = vim.diagnostic.get(bufnr)
	local counts = { ERROR = 0, WARN = 0, INFO = 0, HINT = 0 }
	local items = {}
	for i, d in ipairs(diagnostics) do
		local sev = severity_name(d.severity)
		counts[sev] = (counts[sev] or 0) + 1
		if i <= 40 then
			items[#items + 1] = {
				severity = sev,
				lnum = d.lnum + 1,
				col = d.col + 1,
				message = d.message,
				source = d.source,
				code = d.code,
			}
		end
	end
	return { total = #diagnostics, severity_counts = counts, items = items }
end

local function diagnostics_under_cursor(bufnr, lnum, col)
	local result = {}
	for _, d in ipairs(vim.diagnostic.get(bufnr, { lnum = lnum - 1 })) do
		local start_col = (d.col or 0) + 1
		local end_col = (d.end_col or d.col or 0) + 1
		if col >= start_col and col <= math.max(start_col, end_col) then
			result[#result + 1] = {
				severity = severity_name(d.severity),
				message = d.message,
				source = d.source,
				code = d.code,
			}
		end
	end
	return result
end

local function lsp_clients(bufnr)
	local names = {}
	for _, client in ipairs(vim.lsp.get_clients({ bufnr = bufnr })) do
		names[#names + 1] = client.name
	end
	table.sort(names)
	return names
end

local function enclosing_symbol(bufnr)
	local ok, node = pcall(vim.treesitter.get_node, { bufnr = bufnr })
	if not ok or not node then
		return nil
	end
	local wanted = {
		function_declaration = true,
		function_definition = true,
		function_item = true,
		method_declaration = true,
		method_definition = true,
		method = true,
		arrow_function = true,
		class_declaration = true,
		class_definition = true,
		struct_item = true,
		interface_declaration = true,
	}
	while node do
		local kind = node:type()
		if wanted[kind] then
			local srow, _scol, erow, _ecol = node:range()
			local first = vim.api.nvim_buf_get_lines(bufnr, srow, srow + 1, false)[1] or kind
			first = first:gsub("^%s+", ""):gsub("%s+", " ")
			return { kind = kind, name = first:sub(1, 120), range = { start = srow + 1, ["end"] = erow + 1 } }
		end
		node = node:parent()
	end
	return nil
end

function M.build_context()
	local bufnr = vim.api.nvim_get_current_buf()
	local root = git_root()
	local file = vim.fn.expand("%:p")
	local cursor = vim.api.nvim_win_get_cursor(0)
	local lnum = cursor[1]
	local context_start = math.max(1, lnum - 20)
	local context_end = math.min(vim.api.nvim_buf_line_count(bufnr), lnum + 20)
	local context_lines = vim.api.nvim_buf_get_lines(bufnr, context_start - 1, context_end, false)
	local context_text, context_truncated = clip_lines(context_lines, 12000)

	local selection = nil
	local s1, s2 = selected_range()
	if s1 and s2 then
		local selection_lines = vim.api.nvim_buf_get_lines(bufnr, s1 - 1, s2, false)
		local selection_text, selection_truncated = clip_lines(selection_lines, 16000)
		selection = {
			start = s1,
			end_ = s2,
			["end"] = s2,
			text = selection_text,
			truncated = selection_truncated,
		}
	end

	return {
		ts = os.date("!%Y-%m-%dT%H:%M:%SZ"),
		cwd = vim.fn.getcwd(),
		root = root,
		file = file,
		relative_file = relpath(file, root),
		filetype = vim.bo.filetype,
		mode = vim.fn.mode(),
		cursor = { line = lnum, col = cursor[2] + 1 },
		reference = relpath(file, root) .. ":" .. lnum .. ":" .. (cursor[2] + 1),
		symbol = enclosing_symbol(bufnr),
		lsp = { clients = lsp_clients(bufnr) },
		diagnostic_under_cursor = diagnostics_under_cursor(bufnr, lnum, cursor[2] + 1),
		selection = selection,
		context = {
			start = context_start,
			["end"] = context_end,
			text = context_text,
			truncated = context_truncated,
		},
		diagnostics = diagnostic_snapshot(bufnr),
	}
end

function M.write_context()
	local ctx = M.build_context()
	local root = ctx.root or git_root()
	local project_path = root .. "/.pi/nvim-context.json"
	local global_path = vim.fn.expand("~/.cache/pi-nvim/context.json")
	vim.fn.mkdir(vim.fn.fnamemodify(project_path, ":h"), "p")
	vim.fn.mkdir(vim.fn.fnamemodify(global_path, ":h"), "p")
	local encoded = vim.json.encode(ctx)
	vim.fn.writefile({ encoded }, project_path)
	vim.fn.writefile({ encoded }, global_path)
	vim.notify("Exported Neovim context: " .. project_path)
	return ctx, project_path
end

function M.queue_pi_prompt(prompt)
	local ctx, ctx_path = M.write_context()
	local root = ctx.root or git_root()
	local queue_path = root .. "/.pi/nvim-requests.jsonl"
	vim.fn.mkdir(vim.fn.fnamemodify(queue_path, ":h"), "p")
	local message = prompt
		.. "\n\nUse ctx:nvim. The latest Neovim context was exported from "
		.. ctx_path
		.. "."
	local packet = vim.json.encode({
		ts = os.date("!%Y-%m-%dT%H:%M:%SZ"),
		source = "neovim",
		context_path = ctx_path,
		prompt = message,
	})
	vim.fn.writefile({ packet }, queue_path, "a")
	vim.notify("Queued Pi prompt: " .. queue_path)
end

function M.prompt_active_pi()
	vim.ui.input({ prompt = "Pi prompt: " }, function(prompt)
		if not prompt or prompt == "" then
			return
		end
		M.queue_pi_prompt(prompt)
	end)
end

local function shell_join(parts)
	local escaped = {}
	for _, p in ipairs(parts) do
		escaped[#escaped + 1] = vim.fn.shellescape(p)
	end
	return table.concat(escaped, " ")
end

local function terminal(cmd, root)
	vim.cmd("split")
	vim.cmd("resize 16")
	vim.cmd("terminal " .. cmd)
	vim.cmd("startinsert")
end

local function ask(kind)
	local ctx, ctx_path = M.write_context()
	local root = ctx.root or git_root()
	vim.ui.input({ prompt = kind .. " prompt: " }, function(prompt)
		if not prompt or prompt == "" then
			return
		end
		local bin = kind == "OMP" and (vim.fn.exepath("omp") ~= "" and vim.fn.exepath("omp") or "omp")
			or (vim.fn.exepath("pi") ~= "" and vim.fn.exepath("pi") or "pi")
		local message = "Use the attached Neovim context JSON from my editor. ctx:nvim " .. prompt
		local cmd = "cd " .. vim.fn.shellescape(root) .. " && " .. shell_join({ bin, "@" .. ctx_path, message })
		terminal(cmd, root)
	end)
end

function M.open_pi()
	local ctx, ctx_path = M.write_context()
	local root = ctx.root or git_root()
	local bin = vim.fn.exepath("pi") ~= "" and vim.fn.exepath("pi") or "pi"
	local cmd = "cd " .. vim.fn.shellescape(root) .. " && " .. shell_join({ bin, "@" .. ctx_path, "Use /nvim-context paste, ctx:nvim, or the nvim_context tool when I ask about my current editor state." })
	terminal(cmd, root)
end

function M.open_omp()
	local ctx, ctx_path = M.write_context()
	local root = ctx.root or git_root()
	local bin = vim.fn.exepath("omp") ~= "" and vim.fn.exepath("omp") or "omp"
	local cmd = "cd " .. vim.fn.shellescape(root) .. " && " .. shell_join({ bin, "@" .. ctx_path, "Use the attached Neovim context JSON when I ask about my current editor state. ctx:nvim" })
	terminal(cmd, root)
end

function M.setup()
	vim.keymap.set("n", "<leader>aC", function()
		M.write_context()
	end, { desc = "AI: export Neovim context" })
	vim.keymap.set({ "n", "x" }, "<leader>ap", function()
		M.prompt_active_pi()
	end, { desc = "AI: queue prompt to active Pi" })
	vim.keymap.set({ "n", "x" }, "<leader>aa", function()
		ask("Pi")
	end, { desc = "AI: ask Pi about context" })
	vim.keymap.set({ "n", "x" }, "<leader>aA", function()
		ask("OMP")
	end, { desc = "AI: ask OMP about context" })
	vim.keymap.set("n", "<leader>ai", function()
		M.open_pi()
	end, { desc = "AI: open Pi TUI" })
	vim.keymap.set("n", "<leader>aO", function()
		M.open_omp()
	end, { desc = "AI: open OMP TUI" })
end

M.setup()

return M
