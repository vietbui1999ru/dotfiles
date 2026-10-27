-- Headless checks for the snacks dashboard "Agent Reviews" area (SPEC AC-1..AC-6).
--
-- No real CLI and no real snacks: a temporary stub script stands in for
-- `agent-review list --global --json`, the snacks global is a stub that counts
-- dashboard.update calls, and the agent_review module is stubbed so no review
-- is actually opened.
--
-- Run from the repo root, one case per process:
--   nvim --clean --headless -l scripts/agent-review-dashboard-nvim-test.lua <case>
-- Cases: rows_from_contract, empty_list, cli_failure, non_blocking, open_action, row_cap, row_keys
local CASE = arg[1]
local SELF = debug.getinfo(1, "S").source:sub(2)
local MODULE = assert(
	vim.uv.fs_realpath(SELF:gsub("scripts/[^/]+$", "") .. "nvim/.config/nvim/lua/custom/agent_review_dashboard.lua")
)

local failures, checks = 0, 0
local function check(name, ok, detail)
	checks = checks + 1
	io.write((ok and "  ok   " or "  FAIL ") .. name .. ((not ok and detail) and ("  -- " .. tostring(detail)) or "") .. "\n")
	if not ok then
		failures = failures + 1
	end
end

local function tempdir()
	local dir = vim.fn.tempname()
	vim.fn.mkdir(dir, "p")
	return vim.uv.fs_realpath(dir)
end

local sandbox = tempdir()
local stubs = 0

-- A stub `agent-review`. Every call gets its own script and payload file, so one
-- case can try several CLI behaviours in a row.
local function stub_cli(payload, opts)
	opts = opts or {}
	stubs = stubs + 1
	local data = ("%s/payload-%d.json"):format(sandbox, stubs)
	local script = ("%s/agent-review-%d"):format(sandbox, stubs)
	vim.fn.writefile({ payload }, data)
	local lines = { "#!/bin/sh" }
	if opts.sleep then
		table.insert(lines, "sleep " .. opts.sleep)
	end
	if opts.exit then
		table.insert(lines, "exit " .. opts.exit)
	end
	table.insert(lines, ("cat %s"):format(vim.fn.shellescape(data)))
	vim.fn.writefile(lines, script)
	assert(vim.uv.fs_chmod(script, 493))
	return script
end

local function ago(seconds)
	return os.date("!%Y-%m-%dT%H:%M:%SZ", os.time() - seconds)
end

local updates = 0
_G.Snacks = {
	dashboard = {
		update = function()
			updates = updates + 1
		end,
	},
}
local notices = {}
vim.notify = function(message, level)
	table.insert(notices, { message = message, level = level })
end
local function noticed(pattern, level)
	for _, n in ipairs(notices) do
		if n.message:match(pattern) and (level == nil or n.level == level) then
			return true
		end
	end
	return false
end

local M = dofile(MODULE)

-- Wait for the asynchronous refresh to land in the cache.
local function settle()
	vim.wait(10000, function()
		return not M.refreshing
	end, 10)
end
local function refresh()
	M.refresh()
	settle()
end
local function plain(row, needle)
	return type(row) == "table" and type(row.text) == "string" and row.text:find(needle, 1, true) ~= nil
end
local function any_row(rows, needle)
	for _, row in ipairs(rows) do
		if plain(row, needle) then
			return true
		end
	end
	return false
end
local function texts(rows)
	return vim.tbl_map(function(r)
		return r.text
	end, rows)
end

local ID = {
	broken = "dddddddd-0000-4000-8000-000000000004",
	fresh = "aaaaaaaa-0000-4000-8000-000000000001",
	processing = "cccccccc-0000-4000-8000-000000000003",
	landed = "bbbbbbbb-0000-4000-8000-000000000002",
	orphan = "eeeeeeee-0000-4000-8000-000000000005",
}

-- In the CLI's documented order: non-orphans first, oldest first.
local CONTRACT = {
	{
		runId = ID.broken,
		owner = "/nonexistent/worktrees/broken",
		branch = "feat/broken",
		name = "",
		startedAt = ago(2 * 86400),
		processing = false,
		error = "ruff exited 1",
		landed = false,
		orphan = false,
		repo = "/nonexistent/repos/dotfiles",
	},
	{
		runId = ID.fresh,
		owner = "/nonexistent/worktrees/one",
		branch = "feat/one",
		name = "Add dashboard",
		startedAt = ago(3600),
		processing = false,
		error = nil,
		landed = false,
		orphan = false,
		repo = "/nonexistent/repos/other",
	},
	{
		runId = ID.processing,
		owner = "/nonexistent/worktrees/sweep",
		branch = "",
		name = "Nightly sweep",
		startedAt = ago(120),
		processing = true,
		error = nil,
		landed = false,
		orphan = false,
		repo = "/nonexistent/repos/dotfiles",
	},
	{
		runId = ID.landed,
		owner = "/nonexistent/worktrees/two",
		branch = "feat/two",
		name = "Landed work",
		startedAt = ago(7200),
		processing = false,
		error = nil,
		landed = true,
		orphan = false,
		repo = "/nonexistent/repos/other",
	},
	{
		runId = ID.orphan,
		owner = nil,
		branch = "",
		name = "Orphan review",
		startedAt = ago(60),
		processing = false,
		error = nil,
		landed = false,
		orphan = true,
		repo = "/nonexistent/repos/dotfiles",
	},
}

if CASE == "rows_from_contract" then
	M.cli = stub_cli(vim.json.encode(CONTRACT))
	refresh()
	local rows = M.rows()
	check("one row per non-orphan entry", #rows == 4, vim.inspect(texts(rows)))
	check("the landed review sorts last", plain(rows[4], "[landed]"), rows[4] and rows[4].text)
	check(
		"fresh review first: repo name, name, branch, age",
		plain(rows[1], "dotfiles") and plain(rows[1], ID.broken:sub(1, 8)) and plain(rows[1], "feat/broken")
			and plain(rows[1], "2d")
			and plain(rows[1], "[error]"),
		rows[1] and rows[1].text
	)
	check(
		"an unnamed review falls back to the runId prefix",
		plain(rows[2], "other") and plain(rows[2], "Add dashboard") and plain(rows[2], "feat/one") and plain(rows[2], "1h"),
		rows[2] and rows[2].text
	)
	check("a fresh review carries no tag", not plain(rows[2], "["), rows[2] and rows[2].text)
	check(
		"processing is tagged, an empty branch says detached",
		plain(rows[3], "Nightly sweep") and plain(rows[3], "detached") and plain(rows[3], "[processing]") and plain(rows[3], "2m"),
		rows[3] and rows[3].text
	)
	check("the landed review is tagged", plain(rows[4], "Landed work") and plain(rows[4], "[landed]") and plain(rows[4], "2h"), rows[4] and rows[4].text)
	local orphans = vim.tbl_filter(function(r)
		return plain(r, "Orphan review") or plain(r, ID.orphan:sub(1, 8))
	end, rows)
	check("orphans are left out", #orphans == 0, vim.inspect(texts(rows)))
	check("the title counts non-orphan, non-landed entries", M.count() == 3, M.count())
	local section = M.section()
	check("the section title carries the count", section.title:find("Agent Reviews (3)", 1, true) ~= nil, section.title)
	check("the section is a pane 2 row block", section.pane == 2 and #section == #rows, vim.inspect({ section.pane, #section }))
elseif CASE == "empty_list" then
	M.cli = stub_cli("[]")
	refresh()
	local rows = M.rows()
	check("an empty list is one row", #rows == 1, vim.inspect(texts(rows)))
	check("the row says nothing is waiting", rows[1] and rows[1].text == "No agent reviews waiting", rows[1] and rows[1].text)
	check("the row has no action", rows[1] and rows[1].action == nil)
	check("the title count is zero", M.count() == 0, M.count())
elseif CASE == "cli_failure" then
	local function unavailable(name)
		M.entries, M.failed = nil, false
		refresh()
		local rows = M.rows()
		check(name, #rows == 1 and rows[1].text == "agent-review unavailable", vim.inspect(texts(rows)))
	end
	M.cli = sandbox .. "/no-such-agent-review"
	unavailable("a missing CLI is unavailable")
	M.cli = stub_cli("", { exit = 1 })
	unavailable("a non-zero exit is unavailable")
	M.cli = stub_cli('{"pending":[]}')
	unavailable("a JSON object is unavailable")
	M.cli = stub_cli("not json at all")
	unavailable("non-JSON output is unavailable")
elseif CASE == "non_blocking" then
	M.cli = stub_cli(vim.json.encode(CONTRACT), { sleep = 2 })
	local started = vim.uv.hrtime()
	M.refresh()
	local section = M.section()
	local elapsed_ms = (vim.uv.hrtime() - started) / 1e6
	check(("building the section did not wait for the CLI (%.1f ms)"):format(elapsed_ms), elapsed_ms < 100, elapsed_ms)
	check("the first render says it is checking", any_row(section, "Checking agent reviews..."), vim.inspect(section.title))
	check("nothing is cached yet", M.entries == nil, vim.inspect(M.entries))
	settle()
	check("the cache filled when the CLI finished", M.entries ~= nil and #M.entries == #CONTRACT, M.entries and #M.entries)
	check("the dashboard was asked to update exactly once", updates == 1, updates)
elseif CASE == "open_action" then
	local owner = tempdir()
	local processing_owner = tempdir()
	local opened
	package.loaded["custom.agent_review"] = {
		open_in = function(repo, run_id)
			opened = { repo = repo, run_id = run_id }
		end,
	}
	M.cli = stub_cli(vim.json.encode({
		{
			runId = ID.fresh,
			owner = owner,
			branch = "feat/one",
			name = "Add dashboard",
			startedAt = ago(3600),
			landed = false,
			orphan = false,
			repo = sandbox,
		},
		{
			runId = ID.processing,
			owner = processing_owner,
			branch = "feat/sweep",
			name = "Nightly sweep",
			startedAt = ago(60),
			processing = true,
			landed = false,
			orphan = false,
			repo = sandbox,
		},
	}))
	vim.fn.chdir(sandbox)
	refresh()
	local rows = M.rows()
	check("two rows for the two entries", #rows == 2, vim.inspect(texts(rows)))
	rows[1].action()
	check("Enter sets the tab directory to the owner", vim.fn.getcwd() == owner, vim.fn.getcwd())
	check(
		"Enter opens that review",
		opened ~= nil and opened.repo == owner and opened.run_id == ID.fresh,
		vim.inspect(opened)
	)
	opened = nil
	local before = vim.fn.getcwd()
	rows[2].action()
	check("a processing row warns", noticed("still being processed", vim.log.levels.WARN), vim.inspect(notices))
	check("a processing row opens nothing", opened == nil, vim.inspect(opened))
	check("a processing row leaves the tab directory alone", vim.fn.getcwd() == before, vim.fn.getcwd())
elseif CASE == "row_cap" then
	local owner = tempdir()
	local many = {}
	for i = 1, 7 do
		many[i] = {
			runId = ("%08d-0000-4000-8000-000000000000"):format(i),
			owner = owner,
			branch = "feat/" .. i,
			name = "Review " .. i,
			startedAt = ago(60 * i),
			landed = false,
			orphan = false,
			repo = "/nonexistent/repos/dotfiles",
		}
	end
	M.cli = stub_cli(vim.json.encode(many))
	refresh()
	local rows = M.rows()
	check("five review rows plus the overflow row", #rows == 6, vim.inspect(texts(rows)))
	check("the cap keeps the first five", plain(rows[1], "Review 1") and plain(rows[5], "Review 5"), rows[5] and rows[5].text)
	check("the overflow row counts the rest", plain(rows[6], "+2 more"), rows[6] and rows[6].text)
	check("the overflow row names :AgentReview", plain(rows[6], ":AgentReview"), rows[6] and rows[6].text)
	local ran = 0
	vim.api.nvim_create_user_command("AgentReview", function()
		ran = ran + 1
	end, {})
	rows[6].action()
	check("the overflow row runs :AgentReview", ran == 1, ran)
	check("the title counts every waiting review", M.count() == 7, M.count())
elseif CASE == "row_keys" then
	-- Review rows get letters, so the dashboard's digits stay with Recent Files.
	local owner = tempdir()
	local many = {}
	for i = 1, 7 do
		many[i] = {
			runId = ("%08d-0000-4000-8000-000000000000"):format(i),
			owner = owner,
			branch = "feat/" .. i,
			name = "Review " .. i,
			startedAt = ago(60 * i),
			landed = false,
			orphan = false,
			repo = "/nonexistent/repos/dotfiles",
		}
	end
	M.cli = stub_cli(vim.json.encode(many))
	refresh()
	local rows = M.rows()
	local keys = {}
	for i = 1, 5 do
		keys[i] = rows[i] and rows[i].key
	end
	check("the five review rows are keyed a b d e i", vim.deep_equal(keys, { "a", "b", "d", "e", "i" }), vim.inspect(keys))
	check("no review row asks for an autokey digit", rows[1] and rows[1].autokey == nil, rows[1] and rows[1].autokey)
	check("the overflow row has no key", rows[6] and rows[6].key == nil, rows[6] and rows[6].key)
	M.cli = stub_cli("[]")
	refresh()
	rows = M.rows()
	check("the empty-state row has no key", rows[1] and rows[1].key == nil, rows[1] and rows[1].key)
else
	io.write("unknown case: " .. tostring(CASE) .. "\n")
	os.exit(2)
end

io.write(("%d checks, %d failed\n"):format(checks, failures))
os.exit(failures == 0 and checks > 0 and 0 or 1)
