-- Agent reviews waiting for approval, shown on the snacks.nvim dashboard.
--
-- The list comes from `agent-review list --global --json`, which prints one
-- JSON array of every pending review across repos and worktrees. The scan is
-- asynchronous: the section renders whatever is cached and a refresh started on
-- dashboard open calls Snacks.dashboard.update() when it finishes, so startup
-- never waits on the CLI.
local M = { entries = nil, failed = false, refreshing = false }

-- The CLI lives in the same dotfiles checkout as this module (stow links it in).
local here = vim.uv.fs_realpath(debug.getinfo(1, "S").source:sub(2)) or ""
M.cli = (here:gsub("nvim/%.config/nvim/lua/custom/agent_review_dashboard%.lua$", "scripts/agent-review"))

-- How many review rows the area shows before it collapses the rest into a
-- "+N more" row, so the start screen stays shorter than the keys section.
local MAX_ROWS = 5

local function parse(stdout)
	if type(stdout) ~= "string" then
		return nil
	end
	local text = vim.trim(stdout)
	-- An empty array and an empty object both decode to {}, so the array is
	-- recognised by its bracket before decoding.
	if text:sub(1, 1) ~= "[" then
		return nil
	end
	local ok, value = pcall(vim.json.decode, text)
	if not ok or type(value) ~= "table" then
		return nil
	end
	return value
end

-- Days since 1970-01-01 for a proleptic Gregorian date (Hinnant's
-- days_from_civil). Done by hand because vim.fn.strptime reads its fields as
-- local time, which offsets every age by the zone's UTC offset.
local function days_from_civil(y, m, d)
	if m <= 2 then
		y = y - 1
	end
	local era = math.floor(y / 400)
	local yoe = y - era * 400
	local doy = math.floor((153 * ((m + 9) % 12) + 2) / 5) + d - 1
	local doe = yoe * 365 + math.floor(yoe / 4) - math.floor(yoe / 100) + doy
	return era * 146097 + doe - 719468
end

local function age(started)
	local y, m, d, hh, mm, ss
	if type(started) == "string" then
		y, m, d, hh, mm, ss = started:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)")
	end
	if not y then
		return "?"
	end
	local then_ = days_from_civil(tonumber(y), tonumber(m), tonumber(d)) * 86400
		+ tonumber(hh) * 3600
		+ tonumber(mm) * 60
		+ tonumber(ss)
	local secs = math.max(0, os.time() - then_)
	if secs < 60 then
		return ("%ds"):format(secs)
	elseif secs < 3600 then
		return ("%dm"):format(math.floor(secs / 60))
	elseif secs < 86400 then
		return ("%dh"):format(math.floor(secs / 3600))
	end
	return ("%dd"):format(math.floor(secs / 86400))
end

local function review_name(entry)
	local name = entry.name
	if type(name) == "string" and name ~= "" then
		return name
	end
	return tostring(entry.runId or "?"):sub(1, 8)
end

local function label(entry)
	local repo = vim.fs.basename(entry.repo or entry.owner or "?")
	local branch = type(entry.branch) == "string" and entry.branch ~= "" and entry.branch or "detached"
	local tags = (entry.landed and "  [landed]" or "")
		.. (entry.processing and "  [processing]" or "")
		.. (entry.error and "  [error]" or "")
	return ("%s  %s  %s  %s%s"):format(repo, review_name(entry), branch, age(entry.startedAt), tags)
end

-- Non-orphan entries split into the ones still waiting for approval and the
-- ones already landed. The CLI's order (oldest first) is kept inside each
-- group, so landed reviews sort after the fresh ones.
local function groups()
	local fresh, landed = {}, {}
	for _, entry in ipairs(M.entries or {}) do
		if type(entry) == "table" and not entry.orphan then
			table.insert(entry.landed and landed or fresh, entry)
		end
	end
	return fresh, landed
end

-- How many reviews still need a human, which is what the title counts.
function M.count()
	local fresh = groups()
	return #fresh
end

function M.open_entry(entry)
	if entry.processing then
		return vim.notify(
			("Agent review %s is still being processed"):format(review_name(entry)),
			vim.log.levels.WARN
		)
	end
	local owner = entry.owner
	if type(owner) ~= "string" or owner == "" then
		return vim.notify("That agent review has no worktree to open", vim.log.levels.WARN)
	end
	vim.cmd.tcd(vim.fn.fnameescape(owner))
	require("custom.agent_review").open_in(owner, entry.runId)
end

function M.rows()
	if M.failed then
		return { { text = "agent-review unavailable" } }
	elseif M.entries == nil then
		return { { text = "Checking agent reviews..." } }
	end
	local fresh, landed = groups()
	local all = {}
	vim.list_extend(all, fresh)
	vim.list_extend(all, landed)
	if #all == 0 then
		return { { text = "No agent reviews waiting" } }
	end
	local rows = {}
	for _, entry in ipairs(all) do
		if #rows >= MAX_ROWS then
			break
		end
		table.insert(rows, {
			text = label(entry),
			action = function()
				M.open_entry(entry)
			end,
		})
	end
	if #all > #rows then
		table.insert(rows, {
			text = ("+%d more: :AgentReview"):format(#all - #rows),
			action = function()
				vim.cmd("AgentReview")
			end,
		})
	end
	return rows
end

-- The dashboard section: a titled block of rows in pane 2, above Recent Files.
function M.section()
	local count = M.count()
	local section = {
		pane = 2,
		icon = " ",
		title = count > 0 and ("Agent Reviews (%d)"):format(count) or "Agent Reviews",
		indent = 2,
		padding = 1,
	}
	return vim.list_extend(section, M.rows())
end

local function updated()
	if _G.Snacks and Snacks.dashboard and Snacks.dashboard.update then
		Snacks.dashboard.update()
	end
end

-- Rescan without blocking. `done` runs before the dashboard is asked to redraw.
function M.refresh(done)
	if M.refreshing then
		return
	end
	M.refreshing = true
	-- pcall: a missing or non-executable CLI raises out of vim.system itself
	-- instead of reaching the exit callback.
	local ok = pcall(vim.system, { M.cli, "list", "--global", "--json" }, { text = true }, function(result)
		vim.schedule(function()
			M.refreshing = false
			local entries = result.code == 0 and parse(result.stdout) or nil
			if entries then
				M.entries, M.failed = entries, false
			else
				M.failed = true
			end
			if done then
				done()
			end
			updated()
		end)
	end)
	if not ok then
		M.refreshing = false
		M.failed = true
		vim.schedule(updated)
	end
end

function M.setup()
	if M._autocmd then
		return
	end
	M._autocmd = vim.api.nvim_create_autocmd("User", {
		pattern = "SnacksDashboardOpened",
		callback = function()
			M.refresh()
		end,
	})
end

return M
