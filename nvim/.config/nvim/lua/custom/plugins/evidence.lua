--- evidence.lua — Evidence bridge: LSP/DAP/Diff → .agents/annotations/
---
--- Captures code intelligence artifacts as structured annotations for agent
--- review packages. Each capture writes to .agents/annotations/<task>/ via the
--- annotate-write tool (or direct write as fallback).
---
--- Keymaps:
---   <leader>ae  — capture LSP diagnostics for current buffer
---   <leader>ad  — capture DAP session state (stack/vars, when stopped)
---   <leader>ah  — pin current diff hunk as evidence (via gitsigns)
---
--- All prompt for a task ID with auto-complete from .agents/claimed/.

if vim.g.vscode then
	return
end

local M = {}

-- ─── Tool paths ──────────────────────────────────────────────────────────────

local ANNOTATE_CMD = vim.env.ANNOTATE_CMD or vim.fn.exepath("annotate-write") or "annotate-write"

-- ─── Bus resolution (same as commandr-board) ─────────────────────────────────

local function resolve_bus_dir()
	local script = [[
main=$(dirname "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null)
main=$(cd "$main" 2>/dev/null && pwd -P 2>/dev/null) || exit 1
echo "$main/.agents"
]]
	local result = vim.fn.system({ "bash", "-c", script })
	if vim.v.shell_error ~= 0 then
		return nil
	end
	result = vim.fn.trim(result)
	if vim.fn.isdirectory(result) ~= 0 then
		return result
	end
	return nil
end

-- ─── Task helpers ────────────────────────────────────────────────────────────

--- List claimed tasks from the bus: array of { id, path }.
local function claimed_tasks(bus)
	local files = vim.fn.glob(bus .. "/claimed/*.md", false, true)
	local tasks = {}
	for _, fp in ipairs(files) do
		local name = vim.fn.fnamemodify(fp, ":t:r")
		local task_id = name:match("^[^_]+_[^_]+_(.+)$") or name
		table.insert(tasks, { id = task_id, path = fp })
	end
	table.sort(tasks, function(a, b)
		return a.id < b.id
	end)
	return tasks
end

--- Pick a task interactively. Returns (id, bus) or (nil, nil) if cancelled.
local function pick_task()
	local bus = resolve_bus_dir()
	if not bus then
		vim.notify("No .agents/ bus found — cannot write annotation", vim.log.levels.WARN)
		return nil, nil
	end
	local tasks = claimed_tasks(bus)

	if #tasks == 0 then
		-- No claimed tasks: prompt for manual ID (user might know it)
		local ok, id = pcall(vim.ui.input, {
			prompt = "Task ID (no claimed tasks, enter manually): ",
		})
		if not ok or not id or id == "" then
			return nil, nil
		end
		return id, bus
	end

	if #tasks == 1 then
		return tasks[1].id, bus
	end

	-- Multiple claimed tasks: let user select
	local choices = vim.tbl_map(function(t)
		return t.id
	end, tasks)
	local picked_idx = nil
	local ok = pcall(vim.ui.select, choices, {
		prompt = "Select task for annotation:",
		format_item = function(item)
			return item
		end,
	}, function(choice)
		if choice then
			for i, t in ipairs(tasks) do
				if t.id == choice then
					picked_idx = i
					break
				end
			end
		end
	end)
	if not ok or not picked_idx then
		return nil, nil
	end
	return tasks[picked_idx].id, bus
end

--- Compute the next turn number from existing annotations for a task.
local function next_turn(bus, task_id)
	local dir = bus .. "/annotations/" .. task_id
	if vim.fn.isdirectory(dir) == 0 then
		return 0
	end
	local files = vim.fn.glob(dir .. "/*.json", false, true)
	local max_turn = 0
	for _, fp in ipairs(files) do
		local base = vim.fn.fnamemodify(fp, ":t:r")
		local n = base:match("^(%d+)")
		if n then
			local tn = tonumber(n)
			if tn and tn > max_turn then
				max_turn = tn
			end
		end
	end
	return max_turn + 1
end

--- Write an annotation via annotate-write or direct fallback.
--- @param bus string
--- @param task_id string
--- @param turn number
--- @param anchor string  e.g. "lsp", "dap", "diff-hunk"
--- @param body string    JSON-encoded body content
--- @param author string?
--- @return boolean success
local function write_annotation(bus, task_id, turn, anchor, body, author)
	author = author or "operator:neovim"

	local cmd = {
		ANNOTATE_CMD,
		"--bus", bus,
		"--task", task_id,
		"--turn", tostring(turn),
		"--anchor", anchor,
		"--author", author,
		"--body", body,
	}
	local result = vim.fn.system(cmd)
	if vim.v.shell_error == 0 then
		local path = result:match("annotation:(.+)$") or "?"
		vim.notify(string.format("✓ Annotation (%s) written: %s", anchor, path))
		return true
	end

	-- Fallback: write directly if annotate-write isn't available/working
	local dir = bus .. "/annotations/" .. task_id
	vim.fn.mkdir(dir, "p")
	local existing = vim.fn.glob(dir .. "/" .. string.format("%04d-*.json", turn), false, true)
	local seq = #existing
	local fp = dir .. "/" .. string.format("%04d-%04d.json", turn, seq)
	local annotation = {
		task = task_id,
		turn = turn,
		anchor = anchor,
		ts = os.date("!%Y-%m-%dT%H:%M:%SZ"),
		author = author,
		body = body,
		consumed = false,
	}
	pcall(vim.fn.writefile, { vim.json.encode(annotation) }, fp)
	vim.notify(string.format("✓ Annotation (direct) written: %s", fp))
	return true
end

-- ─── LSP evidence ────────────────────────────────────────────────────────────

--- Capture LSP diagnostics for the current buffer as an annotation.
function M.capture_lsp()
	local task_id, bus = pick_task()
	if not task_id or not bus then
		return
	end

	local bufnr = vim.api.nvim_get_current_buf()
	local filepath = vim.fn.expand("%:p")
	local filename = vim.fn.expand("%:t")
	local filetype = vim.bo.filetype
	local diagnostics = vim.diagnostic.get(bufnr)

	-- Count by severity
	local sev_counts = { ERROR = 0, WARN = 0, INFO = 0, HINT = 0 }
	local sev_map = {
		[vim.diagnostic.severity.ERROR] = "ERROR",
		[vim.diagnostic.severity.WARN] = "WARN",
		[vim.diagnostic.severity.INFO] = "INFO",
		[vim.diagnostic.severity.HINT] = "HINT",
	}

	for _, d in ipairs(diagnostics) do
		local label = sev_map[d.severity] or "UNKNOWN"
		sev_counts[label] = sev_counts[label] + 1
	end

	-- Build messages list (limit to first 50 for annotation body size)
	local messages = {}
	local limit = 50
	for i = 1, math.min(#diagnostics, limit) do
		local d = diagnostics[i]
		local label = sev_map[d.severity] or "?"
		table.insert(messages, {
			severity = label,
			lnum = d.lnum + 1,
			col = d.col + 1,
			message = d.message:gsub('["\\]', function(c)
				return "\\" .. c
			end),
			source = d.source or "",
			code = d.code or "",
		})
	end
	if #diagnostics > limit then
		table.insert(messages, {
			severity = "INFO",
			message = string.format("... and %d more diagnostics", #diagnostics - limit),
		})
	end

	local turn = next_turn(bus, task_id)
	local body = vim.json.encode({
		type = "lsp-diagnostics",
		file = filepath,
		filename = filename,
		filetype = filetype,
		total = #diagnostics,
		severity_counts = sev_counts,
		diagnostics = messages,
	})

	write_annotation(bus, task_id, turn, "lsp-diagnostics", body)
end

-- ─── DAP evidence ────────────────────────────────────────────────────────────

--- Capture the current DAP session state (stack frames + scopes/variables).
function M.capture_dap()
	local task_id, bus = pick_task()
	if not task_id or not bus then
		return
	end

	local ok, dap = pcall(require, "dap")
	if not ok or not dap.session() then
		vim.notify("No active DAP session", vim.log.levels.WARN)
		return
	end

	local session = dap.session()
	local threads = session.threads or {}
	local frames_data = {}
	local total_frames = 0

	-- Collect stack info from all threads
	for _, thread in ipairs(threads) do
		local frames = thread and thread._stackFrames or {}
		total_frames = total_frames + #frames
		for i, frame in ipairs(frames) do
			if i <= 20 then
				local scopes_list = {}
				local scopes_ok, scopes = pcall(frame.scopes, frame)
				if scopes_ok and scopes then
					for _, scope in ipairs(scopes) do
						local vars = {}
						local vars_ok, variables = pcall(scope.variables, scope)
						if vars_ok and variables then
							for j = 1, math.min(#variables, 10) do
								local v = variables[j]
								table.insert(vars, {
									name = v.name or "",
									value = (tostring(v.value) or ""):sub(1, 80),
									type = v.type or "",
									evaluateName = v.evaluateName or "",
								})
							end
						end
						table.insert(scopes_list, {
							name = scope.name or "",
							variables = vars,
							variablesCount = scope.presentationHint and scope.presentationHint.attributesCount or #vars,
						})
					end
				end
				table.insert(frames_data, {
					id = frame.id or 0,
					name = frame.name or "",
					line = (frame.line or 0) + 1,
					column = (frame.column or 0) + 1,
					source = (frame.source and frame.source.path) or "",
					scopes = scopes_list,
				})
			end
		end
	end

	local turn = next_turn(bus, task_id)
	local body = vim.json.encode({
		type = "dap-snapshot",
		thread_count = #threads,
		total_frames = total_frames,
		frames = frames_data,
		buf_file = vim.fn.expand("%:p"),
	})

	write_annotation(bus, task_id, turn, "dap-snapshot", body)
end

-- ─── Diff hunk evidence ──────────────────────────────────────────────────────

--- Capture the current diff hunk as evidence (via gitsigns).
function M.capture_diff_hunk()
	local task_id, bus = pick_task()
	if not task_id or not bus then
		return
	end

	local ok, gs = pcall(require, "gitsigns")
	if not ok then
		vim.notify("gitsigns not available", vim.log.levels.WARN)
		return
	end

	local bufnr = vim.api.nvim_get_current_buf()
	local filepath = vim.fn.expand("%:p")

	-- Get the current hunk at cursor
	local hunks = gs.get_hunks(bufnr)
	if not hunks or #hunks == 0 then
		-- Fallback: try git diff for the file
		local diff = vim.fn.system({
			"git", "diff", "--", filepath,
		})
		if vim.v.shell_error == 0 and diff and diff ~= "" then
			local turn = next_turn(bus, task_id)
			local body = vim.json.encode({
				type = "diff-file",
				file = filepath,
				diff = diff:sub(1, 4000),
				cursor_lnum = vim.fn.line("."),
			})
			write_annotation(bus, task_id, turn, "diff-hunk", body, "operator:neovim")
			return
		end
		vim.notify("No diff hunks found for this file", vim.log.levels.WARN)
		return
	end

	-- Find the hunk at cursor position
	local cursor_lnum = vim.fn.line(".")
	local current_hunk = nil
	for _, hunk in ipairs(hunks) do
		-- hunk has: added, removed, lines (table of {type, value, lnum})
		if hunk.added_start and hunk.removed_start then
			local start_lnum = math.min(hunk.added_start, hunk.removed_start)
			local end_lnum = math.max(
				hunk.added_start + (hunk.added or 0) - 1,
				hunk.removed_start + (hunk.removed or 0) - 1
			)
			if cursor_lnum >= start_lnum and cursor_lnum <= end_lnum then
				current_hunk = hunk
				break
			end
		end
	end

	-- Fallback: git diff for the specific hunk
	-- Use the hunk header info to reconstruct
	local diff_output = ""
	if current_hunk then
		-- Get git diff output for a specific hunk range
		diff_output = vim.fn.system({
			"git", "diff", "--unified=3",
			"-U3",
			"--", filepath,
		}) or ""
	else
		diff_output = vim.fn.system({
			"git", "diff", "--", filepath,
		}) or ""
	end

	-- Truncate large diffs (annotation body has no hard limit but keep it reasonable)
	if #diff_output > 6000 then
		diff_output = diff_output:sub(1, 6000)
			.. "\n... [diff truncated at 6000 chars]"
	end

	local turn = next_turn(bus, task_id)
	local body = vim.json.encode({
		type = "diff-hunk",
		file = filepath,
		filename = vim.fn.expand("%:t"),
		cursor_lnum = cursor_lnum,
		hunk_found = current_hunk ~= nil,
		hunk_stats = current_hunk and {
			added = current_hunk.added,
			removed = current_hunk.removed,
		} or nil,
		diff = diff_output,
	})

	write_annotation(bus, task_id, turn, "diff-hunk", body, "operator:neovim")
end

-- ─── Setup ──────────────────────────────────────────────────────────────────

function M.setup()
	-- LSP evidence capture
	vim.keymap.set("n", "<leader>ae", function()
		M.capture_lsp()
	end, { desc = "Evidence: capture LSP diagnostics" })

	-- DAP evidence capture
	vim.keymap.set("n", "<leader>ad", function()
		M.capture_dap()
	end, { desc = "Evidence: capture DAP session" })

	-- Diff hunk evidence
	vim.keymap.set("n", "<leader>ah", function()
		M.capture_diff_hunk()
	end, { desc = "Evidence: pin diff hunk" })
end

M.setup()

return M
