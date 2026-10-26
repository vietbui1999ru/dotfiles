--- pi-status.lua — Pi agent session status monitor
---
--- Reads Pi's session logs (~/.pi/agent/sessions/*/*.jsonl, last 24 h) for
--- session telemetry (model, last-turn tokens, cost, turns, errors, last tool),
--- including dispatched runs in any worktree. Provides a compact statusline
--- segment (M.statusline) and a floating session viewer.
---
--- Keymaps:
---   <leader>as  — open session viewer
---
--- Statusline (empty when no sessions, auto-hides in lualine):
---   ▶2 deepseek-v4.1..   (2 running)   or   ●5 deepseek-v4.1..   (5 recent, none running)

if vim.g.vscode then
	return
end

local M = {}

-- Pi's own session logs, one JSONL per session: the same files session-band and
-- pi-tail read, so dispatched runs in any worktree show up here.
local sessions_root = vim.fn.expand("~/.pi/agent/sessions")

-- ─── Cache ──────────────────────────────────────────────────────────────────

M._sessions = {} -- sessionId → { data = summary, ts = msec }
M._last_poll_ms = 0
local POLL_INTERVAL_MS = 3000 -- vim.uv.now() msec resolution
local RECENT_S = 24 * 3600 -- sessions written within this window are listed
local MAX_SESSIONS = 12
local RUNNING_S = 20 -- a log written this recently counts as a running session
local parsed_cache = {} -- path → { size = bytes, data = summary }

-- Summarize one session log into the fields the statusline and viewer show.
local function summarize(path)
	local data = { path = path, sessionId = path:match("_([^/]+)%.jsonl$") or path, turns = 0, toolCalls = 0, errors = 0, cost = 0 }
	for _, line in ipairs(vim.fn.readfile(path)) do
		local ok, rec = pcall(vim.json.decode, line)
		local msg = ok and type(rec) == "table" and rec.type == "message" and rec.message or nil
		if type(msg) == "table" and msg.role == "assistant" then
			data.turns = data.turns + 1
			data.model = msg.provider and msg.model and (msg.provider .. "/" .. msg.model) or msg.model or data.model
			local usage = type(msg.usage) == "table" and msg.usage or {}
			data.tokens = usage.totalTokens or data.tokens
			data.cost = data.cost + (type(usage.cost) == "table" and usage.cost.total or 0)
			if msg.stopReason == "error" then data.errors = data.errors + 1 end
			for _, part in ipairs(type(msg.content) == "table" and msg.content or {}) do
				if type(part) == "table" and part.type == "toolCall" then
					data.toolCalls = data.toolCalls + 1
					data.lastTool = part.name
				end
			end
		end
	end
	return data
end

local function poll()
	local now = vim.uv.now()
	if now - M._last_poll_ms < POLL_INTERVAL_MS then
		return
	end
	M._last_poll_ms = now

	local wall = os.time()
	local recent = {}
	for _, fp in ipairs(vim.fn.glob(sessions_root .. "/*/*.jsonl", false, true)) do
		local stat = vim.uv.fs_stat(fp)
		if stat and wall - stat.mtime.sec <= RECENT_S then
			table.insert(recent, { path = fp, stat = stat })
		end
	end
	table.sort(recent, function(a, b) return a.stat.mtime.sec > b.stat.mtime.sec end)

	local fresh = {}
	for index = 1, math.min(#recent, MAX_SESSIONS) do
		local fp, stat = recent[index].path, recent[index].stat
		local cached = parsed_cache[fp]
		-- Re-read a log only when it grew; the summary is otherwise unchanged.
		if not cached or cached.size ~= stat.size then
			local ok, data = pcall(summarize, fp)
			cached = { size = stat.size, data = ok and data or { path = fp, sessionId = fp } }
			parsed_cache[fp] = cached
		end
		local data = cached.data
		data.status = wall - stat.mtime.sec <= RUNNING_S and "running" or "idle"
		data.mtime = stat.mtime.sec
		fresh[data.sessionId] = { data = data, ts = now }
	end
	M._sessions = fresh
end

-- ─── Public API ─────────────────────────────────────────────────────────────

function M.statusline()
	poll()
	if vim.tbl_isempty(M._sessions) then
		return ""
	end

	-- Count running sessions; show the model of the most recently written one.
	local count = 0
	local top_model = ""
	local newest = -1
	local any_active = false
	for _, entry in pairs(M._sessions) do
		local d = entry.data
		if d.status == "running" then
			count = count + 1
			any_active = true
		end
		if (d.mtime or 0) > newest then
			newest = d.mtime or 0
			top_model = d.model or ""
		end
	end
	if not any_active then
		count = vim.tbl_count(M._sessions)
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
	local text = string.format("%s%d %s", indicator, count, model_label)
	-- lualine embeds this raw into &statusline/&winbar; unescaped '%' next to
	-- an adjacent segment's text (e.g. "109%utf-8") is read as a statusline
	-- directive and raises E539. Built-in lualine components escape via
	-- stl_escape() for the same reason; this component isn't one of those.
	return (text:gsub("%%", "%%%%"))
end

-- ─── Session Viewer (floating window) ───────────────────────────────────────

function M.open_session_view()
	poll()
	if vim.tbl_isempty(M._sessions) then
		vim.notify("No Pi sessions written in the last 24 h under " .. sessions_root, vim.log.levels.INFO)
		return
	end

	-- Build sorted list of session IDs (most recently written first)
	local sorted = {}
	for id, _ in pairs(M._sessions) do
		table.insert(sorted, id)
	end
	table.sort(sorted, function(a, b) return (M._sessions[a].data.mtime or 0) > (M._sessions[b].data.mtime or 0) end)

	local lines = {}
	local sep = string.rep("─", 64)
	table.insert(lines, "  Pi Agent Sessions" .. string.rep(" ", 64 - 18) .. "  ")
	table.insert(lines, "")
	table.insert(lines, "  " .. sep)
	table.insert(lines, string.format("  %-10s %-18s %-6s %-6s %-8s  %s",
		"SESSION", "MODEL", "STATUS", "TOKENS", "COST", "LAST TOOL"))
	table.insert(lines, "  " .. sep)

	local row_count = 0
	for _, id in ipairs(sorted) do
		local entry = M._sessions[id]
		local d = entry.data
		-- The last turn's total tokens, in thousands; session logs carry no context percentage.
		local tokens_k = math.floor((d.tokens or 0) / 1000 + 0.5)
		local cost = d.cost or 0
		local model = d.model or "?"
		if model:find("/") then
			model = model:match("[^/]+$")
		end
		model = #model > 18 and model:sub(1, 17) .. "…" or model
		local status = d.status or "?"
		local status_icon = ""
		if status == "running" or status == "active" then
			status_icon = "▶"
		elseif status == "idle" then
			status_icon = "●"
		else
			status_icon = "○"
		end
		-- Dispatched sessions are named pueue-<slug>; drop the common prefix before shortening.
		local short_id = id:gsub("^pueue%-", "")
		short_id = #short_id > 10 and short_id:sub(1, 10) or short_id
		local last_tool = d.lastTool or "-"
		last_tool = #last_tool > 10 and last_tool:sub(1, 8) .. ".." or last_tool
		table.insert(lines, string.format("  %-10s %-18s %s%-5s %4dk  $%-6.4f %s",
			short_id, model, status_icon, status, tokens_k, cost, last_tool))
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

	-- CR: open the session's JSONL log
	vim.keymap.set("n", "<CR>", function()
		local lnum = vim.api.nvim_win_get_cursor(0)[1] - 1 -- 0-indexed
		local sid = session_at_line(lnum)
		if not sid then
			return
		end
		local path = M._sessions[sid] and M._sessions[sid].data.path
		if not path or vim.fn.filereadable(path) == 0 then
			vim.notify("Session log for " .. sid .. " is gone", vim.log.levels.WARN)
			return
		end
		close_win()
		vim.cmd("edit " .. vim.fn.fnameescape(path))
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
