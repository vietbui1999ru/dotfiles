--- commandr-board.lua — Commandr .agents/ bus board
---
--- Reads the repository-local .agents/ bus directory (inbox/claimed/done + 
--- events.jsonl + registry.json) and renders a navigable board.
---
--- Phase 2 adds guarded actions: progress, complete, launch runner.
---
--- Keymaps:
---   <leader>ab  — open board
---
--- Board keymaps:
---   e  open packet markdown
---   y  yank task ID to clipboard
---   p  append progress note (claimed only)
---   x  complete pass/fail with confirmation (claimed only)
---   l  launch omp runner in terminal (claimed only)
---   q  close board
---   r  refresh

if vim.g.vscode then
	return
end

local M = {}

-- ─── Constant tool paths ────────────────────────────────────────────────────

-- Resolve CLI tools, respecting env var seams (same pattern as commandr-omp-runner)
local OMP_BIN = vim.env.OMP_BIN or vim.fn.exepath("omp") or "omp"
local PROGRESS_CMD = vim.env.PROGRESS_CMD or vim.fn.exepath("progress") or "progress"
local COMPLETE_CMD = vim.env.COMPLETE_CMD or vim.fn.exepath("complete") or "complete"
local RUNNER_CMD = vim.env.RUNNER_CMD or vim.fn.exepath("commandr-omp-runner") or "commandr-omp-runner"

-- ─── Cache ──────────────────────────────────────────────────────────────────

M._bus_path = nil
M._last_poll_ms = 0
local POLL_INTERVAL_MS = 5000

-- ─── Bus directory resolution ───────────────────────────────────────────────
--
-- Follows Commandr LAYOUT-1: resolves the main checkout's .agents/ from any
-- worktree using the same shell pipeline as bin/progress and bin/claim.

local function resolve_bus_dir()
	if M._bus_path and vim.loop.now() - M._last_poll_ms < POLL_INTERVAL_MS then
		return M._bus_path
	end

	local script = [[
main=$(dirname "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null)
main=$(cd "$main" 2>/dev/null && pwd -P 2>/dev/null) || exit 1
echo "$main/.agents"
]]
	local result = vim.fn.system({ "bash", "-c", script })
	if vim.v.shell_error ~= 0 then
		M._bus_path = nil
		return nil
	end
	result = vim.fn.trim(result)
	if vim.fn.isdirectory(result) ~= 0 then
		M._bus_path = result
		return result
	end
	M._bus_path = nil
	return nil
end

-- ─── Resolve repo root from .agents/ path ──────────────────────────────────

local function repo_root_from_bus(bus)
	-- .agents/ is inside the repo root; strip "/.agents" (8 chars)
	if bus:match("/%.agents$") then
		return bus:sub(1, #bus - 8)
	end
	if bus:match("/%.agents/") then
		return bus:match("^(.*)/%.agents/")
	end
	return bus
end

-- ─── Data collection ────────────────────────────────────────────────────────

local function read_task_dir(dir)
	local files = vim.fn.glob(dir .. "/*.md", false, true)
	local entries = {}
	for _, fp in ipairs(files) do
		local name = vim.fn.fnamemodify(fp, ":t:r")
		table.insert(entries, { name = name, path = fp })
	end
	table.sort(entries, function(a, b)
		return a.name < b.name
	end)
	return entries
end

local function read_events(bus, limit)
	limit = limit or 5
	local events_path = bus .. "/events.jsonl"
	if vim.fn.filereadable(events_path) == 0 then
		return {}
	end
	local ok, raw = pcall(vim.fn.readfile, events_path)
	if not ok or not raw then
		return {}
	end
	local n = #raw
	local tail = {}
	for i = math.max(1, n - limit + 1), n do
		local parsed, ev = pcall(vim.json.decode, raw[i])
		if parsed and type(ev) == "table" then
			table.insert(tail, ev)
		else
			table.insert(tail, { event = "?", ts = "?", note = raw[i]:gsub("^(.{60}).*$", "%1…") })
		end
	end
	return tail
end

local function read_registry(bus)
	local rpath = bus .. "/registry.json"
	if vim.fn.filereadable(rpath) == 0 then
		return nil
	end
	local ok, raw = pcall(vim.fn.readfile, rpath)
	if not ok or not raw then
		return nil
	end
	local parsed, data = pcall(vim.json.decode, table.concat(raw, "\n"))
	if parsed and type(data) == "table" then
		return data
	end
	return nil
end

-- ─── Helpers ────────────────────────────────────────────────────────────────

-- Extract task ID from a claimed/done packet name: host_pid_TASKID → TASKID
local function extract_task_id(name)
	return name:match("^[^_]+_[^_]+_(.+)$") or name
end

-- Check if a path is .failed (e.g. foo.failed.md or foo.md → no, but filename ends with .failed?)
local function is_failed(name)
	return name:match("%.failed$") ~= nil
end

-- ─── Board rendering ────────────────────────────────────────────────────────

function M.open_board()
	local bus = resolve_bus_dir()
	if not bus then
		vim.notify("No .agents/ bus found in repository", vim.log.levels.WARN)
		return
	end
	M._last_poll_ms = vim.loop.now()
	local root = repo_root_from_bus(bus)

	-- Collect data
	local inbox = read_task_dir(bus .. "/inbox")
	local claimed = read_task_dir(bus .. "/claimed")
	local done_list = read_task_dir(bus .. "/done")
	local events = read_events(bus, 5)
	local registry = read_registry(bus)

	-- Build agent lookup
	local agent_map = {}
	if registry and registry.agents then
		for _, agent_entry in ipairs(registry.agents) do
			if agent_entry.task and agent_entry.id then
				agent_map[agent_entry.task] = agent_entry.id
			end
		end
	end

	-- ── Build structured sections ──
	--
	-- Each section: { start (0-indexed line in lines[]), count, items[], name }
	-- Used by entry_at_lnum() for all keymap actions.
	local sections = {}
	local current_line = 2 -- after title + blank (lines 0-1)

	local function add_section(name, items)
		local start = current_line + 2 -- skip header + separator
		table.insert(sections, { start = start, count = #items, items = items, name = name })
		current_line = start + #items + 2 -- after data + blank + events start
	end

	-- Build display lines and record sections
	local lines = {}
	local sep = string.rep("─", 70)

	table.insert(lines, "  Commandr Bus Board" .. string.rep(" ", 72 - 19) .. "  ")
	table.insert(lines, "")

	-- ── Inbox ──
	table.insert(lines, "  INBOX  (" .. #inbox .. ")")
	table.insert(lines, "  " .. sep)
	if #inbox == 0 then
		table.insert(lines, "    — empty")
	else
		for _, entry in ipairs(inbox) do
			local task_id = extract_task_id(entry.name)
			local agent = agent_map[task_id]
			local agent_tag = agent and string.format(" @%s", agent:sub(1, 8)) or ""
			table.insert(lines, string.format("    %-50s%s", task_id, agent_tag))
		end
	end
	table.insert(lines, "")
	add_section("inbox", inbox)

	-- ── Claimed ──
	table.insert(lines, "  CLAIMED  (" .. #claimed .. ")")
	table.insert(lines, "  " .. sep)
	if #claimed == 0 then
		table.insert(lines, "    — empty")
	else
		for _, entry in ipairs(claimed) do
			local task_id = extract_task_id(entry.name)
			local agent = agent_map[task_id]
			local agent_tag = agent and string.format(" @%s", agent:sub(1, 8)) or ""
			table.insert(lines, string.format("    %-50s%s", task_id, agent_tag))
		end
	end
	table.insert(lines, "")
	add_section("claimed", claimed)

	-- ── Done ──
	table.insert(lines, "  DONE  (" .. #done_list .. ")")
	table.insert(lines, "  " .. sep)
	if #done_list == 0 then
		table.insert(lines, "    — empty")
	else
		for _, entry in ipairs(done_list) do
			local task_id = extract_task_id(entry.name)
			local failed = is_failed(entry.name)
			local done_tag = failed and " ✗" or " ✓"
			table.insert(lines, string.format("    %-50s%s", task_id, done_tag))
		end
	end
	table.insert(lines, "")
	add_section("done", done_list)

	-- ── Recent events ──
	table.insert(lines, "  EVENTS  (last " .. #events .. ")")
	table.insert(lines, "  " .. sep)
	if #events == 0 then
		table.insert(lines, "    — no events")
	else
		for _, ev in ipairs(events) do
			local ts = ev.ts or ""
			local event_type = ev.event or "?"
			local task = ev.task or ""
			local note = ev.note or ""
			if #ts > 22 then
				ts = ts:sub(12, 22)
			elseif #ts > 10 then
				ts = ts:sub(6, 16)
			end
			if #task > 16 then
				task = task:sub(1, 14) .. ".."
			end
			if #note > 36 then
				note = note:sub(1, 34) .. ".."
			end
			table.insert(lines, string.format("    %-14s %-14s %s", ts, event_type, note))
		end
	end
	table.insert(lines, "")
	table.insert(lines, "  e:open  y:yank-id  p:progress  x:complete  l:launch  q:close  r:refresh")
	table.insert(lines, "")

	-- Create buffer
	local buf = vim.api.nvim_create_buf(false, true)
	vim.bo[buf].filetype = "commandr-board"
	vim.bo[buf].bufhidden = "wipe"
	vim.bo[buf].modifiable = true
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
	vim.bo[buf].modifiable = false

	-- Highlight
	vim.api.nvim_buf_add_highlight(buf, -1, "Title", 0, 0, -1)
	vim.api.nvim_buf_add_highlight(buf, -1, "Comment", #lines - 2, 0, -1)

	-- Calculate dimensions
	local width = 74
	local height = math.min(#lines + 2, vim.o.lines - 4)
	local row = math.floor((vim.o.lines - height) / 2)
	local col = math.floor((vim.o.columns - width) / 2)

	local win = vim.api.nvim_open_win(buf, true, {
		relative = "editor",
		width = width,
		height = height,
		row = row,
		col = col,
		style = "minimal",
		border = "rounded",
		title = " Commandr Task Board ",
		title_pos = "center",
	})

	-- ── Shared helpers ──

	local function close_win()
		if vim.api.nvim_win_is_valid(win) then
			vim.api.nvim_close_win(win)
		end
	end

	-- Find which data section and entry a 1-indexed line number maps to.
	-- Returns (name, entry) or (nil, nil) if not on a data line.
	local function entry_at_lnum(lnum)
		local idx_0 = lnum - 1 -- 0-indexed
		for _, sec in ipairs(sections) do
			if idx_0 >= sec.start and idx_0 < sec.start + sec.count then
				local item_idx = idx_0 - sec.start + 1
				return sec.name, sec.items[item_idx]
			end
		end
		return nil, nil
	end

	-- ── Keymaps ──
	local buf_opts = { buffer = buf, noremap = true, silent = true }

	-- Close
	vim.keymap.set("n", "q", close_win, vim.tbl_extend("force", buf_opts, { desc = "Close" }))
	vim.keymap.set("n", "<Esc>", close_win, vim.tbl_extend("force", buf_opts, { desc = "Close" }))

	-- Refresh
	vim.keymap.set("n", "r", function()
		M._bus_path = nil
		close_win()
		M.open_board()
	end, vim.tbl_extend("force", buf_opts, { desc = "Refresh" }))

	-- Yank task ID
	vim.keymap.set("n", "y", function()
		local lnum = vim.api.nvim_win_get_cursor(0)[1]
		local name, entry = entry_at_lnum(lnum)
		if not entry then
			vim.notify("No task on this line", vim.log.levels.INFO)
			return
		end
		local task_id = extract_task_id(entry.name)
		vim.fn.setreg("+", task_id)
		vim.notify("Yanked: " .. task_id)
	end, vim.tbl_extend("force", buf_opts, { desc = "Yank task ID" }))

	-- Open packet
	vim.keymap.set("n", "e", function()
		local lnum = vim.api.nvim_win_get_cursor(0)[1]
		local name, entry = entry_at_lnum(lnum)
		if not entry then
			vim.notify("No packet on this line", vim.log.levels.INFO)
			return
		end
		close_win()
		vim.cmd("edit " .. vim.fn.fnameescape(entry.path))
	end, vim.tbl_extend("force", buf_opts, { desc = "Open packet" }))

	-- Append progress (claimed only)
	vim.keymap.set("n", "p", function()
		local lnum = vim.api.nvim_win_get_cursor(0)[1]
		local section_name, entry = entry_at_lnum(lnum)
		if not entry then
			vim.notify("No task on this line", vim.log.levels.INFO)
			return
		end
		if section_name ~= "claimed" then
			vim.notify("Progress can only be appended to claimed tasks", vim.log.levels.WARN)
			return
		end
		local task_id = extract_task_id(entry.name)
		vim.ui.input({ prompt = "Progress note: " }, function(text)
			if not text or text == "" then
				return
			end
			-- Run in repo root directory
			local cwd = vim.fn.getcwd()
			vim.fn.chdir(root)
			local result = vim.fn.system({ PROGRESS_CMD, task_id, text })
			vim.fn.chdir(cwd)
			if vim.v.shell_error ~= 0 then
				vim.notify("Progress failed: " .. (result or "error"), vim.log.levels.ERROR)
			else
				vim.notify("Progress recorded: " .. task_id)
				close_win()
				M.open_board()
			end
		end)
	end, vim.tbl_extend("force", buf_opts, { desc = "Append progress" }))

	-- Complete pass/fail (claimed only)
	vim.keymap.set("n", "x", function()
		local lnum = vim.api.nvim_win_get_cursor(0)[1]
		local section_name, entry = entry_at_lnum(lnum)
		if not entry then
			vim.notify("No task on this line", vim.log.levels.INFO)
			return
		end
		if section_name ~= "claimed" then
			vim.notify("Only claimed tasks can be completed", vim.log.levels.WARN)
			return
		end
		local task_id = extract_task_id(entry.name)
		local choice = vim.fn.confirm(
			"Complete task " .. task_id .. "?",
			"&Pass\n&Fail\n&Cancel",
			3,
			"Info"
		)
		if choice == 0 or choice == 3 then
			return
		end
		local result_str = choice == 1 and "pass" or "fail"
		local cwd = vim.fn.getcwd()
		vim.fn.chdir(root)
		local output = vim.fn.system({ COMPLETE_CMD, entry.path, result_str })
		vim.fn.chdir(cwd)
		if vim.v.shell_error ~= 0 then
			vim.notify("Complete failed: " .. (output or "error"), vim.log.levels.ERROR)
		else
			vim.notify("Task completed: " .. task_id .. " (" .. result_str .. ")")
			close_win()
			M.open_board()
		end
	end, vim.tbl_extend("force", buf_opts, { desc = "Complete task" }))

	-- Launch omp runner in terminal (claimed only)
	vim.keymap.set("n", "l", function()
		local lnum = vim.api.nvim_win_get_cursor(0)[1]
		local section_name, entry = entry_at_lnum(lnum)
		if not entry then
			vim.notify("No task on this line", vim.log.levels.INFO)
			return
		end
		if section_name ~= "claimed" then
			vim.notify("Only claimed tasks can be launched", vim.log.levels.WARN)
			return
		end
		local task_id = extract_task_id(entry.name)
		vim.ui.input({ prompt = "Model (optional, e.g. claude-sonnet-4-6): " }, function(model)
			-- Build workspace path
			local workspace_dir = root .. "/workspaces/" .. task_id
			local cmd_parts = { "bash", "-c", string.format(
				[[
cd %s && %s --claimed %s --workspace %s %s
echo ''
echo '[Press any key to close this terminal]'
read -n1
]],
				vim.fn.shellescape(root),
				vim.fn.shellescape(RUNNER_CMD),
				vim.fn.shellescape(entry.path),
				vim.fn.shellescape(workspace_dir),
				(model and model ~= "") and ("--model " .. vim.fn.shellescape(model)) or ""
			) }
			-- Open terminal in a horizontal split
			vim.cmd("split | resize 12 | terminal " .. vim.fn.join(vim.fn.map(cmd_parts, function(v)
				return vim.fn.shellescape(v)
			end), " "))
			-- Focus the terminal buffer (it already has focus after :terminal)
			close_win()
		end)
	end, vim.tbl_extend("force", buf_opts, { desc = "Launch omp runner" }))
end

-- ─── Setup ──────────────────────────────────────────────────────────────────

function M.setup()
	vim.keymap.set("n", "<leader>ab", function()
		M.open_board()
	end, { desc = "Commandr: open board" })
end

M.setup()

return M
