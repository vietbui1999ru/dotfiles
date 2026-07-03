--- pi-status.lua — Pi agent session status monitor
---
--- Reads ~/.pi/status/*.json for live session telemetry (model, context%,
--- cost, turns, errors, currentTool). Provides a compact lualine segment
--- and a floating session viewer.
---
--- Keymaps:
---   <leader>as  — open session viewer
---
--- Statusline (empty when no sessions, auto-hides in lualine):
---   〷2 glm-5.2 11%   or   〷1 deepseek-v4-flash 5%

if vim.g.vscode then
	return
end

local M = {}

local status_dir = vim.fn.expand("~/.pi/status")
local omp_sessions_root = vim.fn.expand("~/.omp/agent/sessions")

-- ─── Cache ──────────────────────────────────────────────────────────────────

M._sessions = {} -- sessionId → { data = json, ts = msec }
M._last_poll_ms = 0
local POLL_INTERVAL_MS = 3000 -- vim.loop.now() msec resolution

local function poll()
	local now = vim.loop.now()
	if now - M._last_poll_ms < POLL_INTERVAL_MS then
		return
	end
	M._last_poll_ms = now

	local files = vim.fn.glob(status_dir .. "/*.json", false, true)
	local fresh = {}
	for _, fp in ipairs(files) do
		local ok, raw = pcall(vim.fn.readfile, fp)
		if ok and raw and #raw > 0 then
			local text = table.concat(raw, "\n")
			local parsed, data = pcall(vim.json.decode, text)
			if parsed and type(data) == "table" and data.sessionId then
				fresh[data.sessionId] = { data = data, ts = now }
			end
		end
	end
	M._sessions = fresh
end

-- ─── Public API ─────────────────────────────────────────────────────────────

function M.statusline()
	poll()
	if vim.tbl_isempty(M._sessions) then
		return ""
	end

	local count = 0
	local top_model = ""
	local top_ctx = 0
	local any_active = false
	for _, entry in pairs(M._sessions) do
		local d = entry.data
		if d.status then
			count = count + 1
		end
		if d.status == "running" or d.status == "active" then
			any_active = true
		end
		local ctx_pct = d.context and d.context.percentUsed or 0
		if ctx_pct > top_ctx then
			top_ctx = ctx_pct
			top_model = d.model or ""
		end
	end

	if count == 0 then
		return ""
	end

	-- Shorten model names: "glm-5.2" → "glm-5.2", "opencode-go/kimi-k2.5" → "kimi"
	local model_label = top_model
	if model_label:find("/") then
		-- Take the part after the last /
		model_label = model_label:match("[^/]+$")
	end
	-- Truncate very long model names
	if #model_label > 14 then
		model_label = model_label:sub(1, 12) .. ".."
	end

	local indicator = any_active and "▶" or "●"
	return string.format("%s%d %s %d%%", indicator, count, model_label, math.floor(top_ctx + 0.5))
end

-- ─── Session Viewer (floating window) ───────────────────────────────────────

function M.open_session_view()
	poll()
	if vim.tbl_isempty(M._sessions) then
		vim.notify("No Pi agent sessions found in " .. status_dir, vim.log.levels.INFO)
		return
	end

	-- Build sorted list of session IDs (newest first)
	local sorted = {}
	for id, _ in pairs(M._sessions) do
		table.insert(sorted, id)
	end
	vim.fn.sort(sorted)
	-- Reverse: newest first (UUIDs are roughly chronological)
	table.sort(sorted, function(a, b) return a > b end)

	local lines = {}
	local sep = string.rep("─", 64)
	table.insert(lines, "  Pi Agent Sessions" .. string.rep(" ", 64 - 18) .. "  ")
	table.insert(lines, "")
	table.insert(lines, "  " .. sep)
	table.insert(lines, string.format("  %-10s %-18s %-6s %-6s %-8s  %s",
		"SESSION", "MODEL", "STATUS", "CTX%", "COST", "LAST TOOL"))
	table.insert(lines, "  " .. sep)

	local row_count = 0
	for _, id in ipairs(sorted) do
		local entry = M._sessions[id]
		local d = entry.data
		local ctx_pct = d.context and d.context.percentUsed or 0
		local cost = d.cost or 0
		local model = d.model or "?"
		if model:find("/") then
			model = model:match("[^/]+$")
		end
		local status = d.status or "?"
		local status_icon = ""
		if status == "running" or status == "active" then
			status_icon = "▶"
		elseif status == "idle" then
			status_icon = "●"
		else
			status_icon = "○"
		end
		local short_id = #id > 8 and id:sub(1, 8) or id
		local last_tool = d.lastTool or "-"
		last_tool = #last_tool > 10 and last_tool:sub(1, 8) .. ".." or last_tool
		table.insert(lines, string.format("  %-10s %-18s %s%-5s %3d%%  $%-6.4f %s",
			short_id, model, status_icon, status, math.floor(ctx_pct + 0.5), cost, last_tool))
		table.insert(lines, string.format("  %12s %d turns · %d toolcalls · %d errors · $%.4f total",
			"", d.turns or 0, d.toolCalls or 0, d.errors or 0, cost))
		row_count = row_count + 1
	end
	table.insert(lines, "")
	table.insert(lines, "  " .. sep)
	table.insert(lines, string.format("  %d session(s)  •  <CR> open log  •  q close  •  r refresh",
		row_count))
	table.insert(lines, "")

	-- Create buffer
	local buf = vim.api.nvim_create_buf(false, true)
	vim.bo[buf].filetype = "pi-status"
	vim.bo[buf].bufhidden = "wipe"
	vim.bo[buf].modifiable = true
	vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)
	vim.bo[buf].modifiable = false

	-- Highlight session id lines
	vim.api.nvim_buf_add_highlight(buf, -1, "Title", 0, 0, -1)
	vim.api.nvim_buf_add_highlight(buf, -1, "Special", 3, 0, -1) -- header separator
	vim.api.nvim_buf_add_highlight(buf, -1, "Type", 4, 0, -1) -- column headers
	vim.api.nvim_buf_add_highlight(buf, -1, "Special", 5, 0, -1) -- header separator
	vim.api.nvim_buf_add_highlight(buf, -1, "Comment", #lines - 2, 0, -1) -- footer

	-- Calculate dimensions
	local width = 68
	local height = math.min(#lines + 2, vim.o.lines - 6)
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
		title = " Pi Agent Sessions ",
		title_pos = "center",
	})

	-- Recalculate session index from buffer line number
	local function session_at_line(lnum)
		-- Lines: 0-5 = header, then pairs of data lines, then footer
		-- Each session occupies 2 lines (main row + detail row), starting at line 6 (0-indexed: 5)
		if lnum < 5 then
			return nil
		end
		local data_offset = lnum - 5 -- 0-indexed within data block
		local sidx = math.floor(data_offset / 2) + 1 -- 1-indexed within sorted
		if sidx < 1 or sidx > #sorted then
			return nil
		end
		-- Check we're on an even line within the pair (the main row, not the detail row)
		if data_offset % 2 ~= 0 then
			return nil
		end
		return sorted[sidx]
	end

	local function close_win()
		if vim.api.nvim_win_is_valid(win) then
			vim.api.nvim_close_win(win)
		end
	end

	-- Keymaps
	local buf_opts = { buffer = buf, noremap = true, silent = true }
	vim.keymap.set("n", "q", close_win, vim.tbl_extend("force", buf_opts, { desc = "Close" }))
	vim.keymap.set("n", "<Esc>", close_win, vim.tbl_extend("force", buf_opts, { desc = "Close" }))

	-- Refresh
	vim.keymap.set("n", "r", function()
		M._last_poll_ms = 0 -- force re-poll
		close_win()
		M.open_session_view()
	end, vim.tbl_extend("force", buf_opts, { desc = "Refresh" }))

	-- CR: open the OMP session log file or status JSON
	vim.keymap.set("n", "<CR>", function()
		local lnum = vim.api.nvim_win_get_cursor(0)[1] - 1 -- 0-indexed
		local sid = session_at_line(lnum)
		if not sid then
			return
		end
		-- Search OMP session dir for a file matching this sessionId
		local pattern = omp_sessions_root .. "/*/*" .. sid .. "*.jsonl"
		local matches = vim.fn.glob(pattern, false, true)
		if #matches == 0 then
			-- Try the status JSON itself as fallback
			local status_file = status_dir .. "/" .. sid .. ".json"
			if vim.fn.filereadable(status_file) ~= 0 then
				close_win()
				vim.cmd("edit " .. vim.fn.fnameescape(status_file))
				return
			end
			vim.notify("No OMP session log or status file found for " .. sid, vim.log.levels.WARN)
			return
		end
		close_win()
		vim.cmd("edit " .. vim.fn.fnameescape(matches[1]))
	end, vim.tbl_extend("force", buf_opts, { desc = "Open session log" }))
end

-- ─── Setup ──────────────────────────────────────────────────────────────────

function M.setup()
	vim.keymap.set("n", "<leader>as", function()
		M.open_session_view()
	end, { desc = "Pi: list sessions" })
end

M.setup()

return M
