-- Headless checks for cross-worktree :AgentReview (SPEC AC-10..AC-12).
--
-- Real repos, real `git worktree add`, and the real `scripts/agent-review list
-- --all --json` from this checkout; diffview, gitsigns and vim.ui.select are stubbed.
--
-- Run from the repo root, one case per process:
--   nvim --clean --headless -l scripts/agent-review-nvim-xwt-test.lua <case>
-- Cases: single_opens_owner, picker_order_and_tags, cli_failure_fallback
local CASE = arg[1]
local SELF = debug.getinfo(1, "S").source:sub(2)
local MODULE = assert(vim.uv.fs_realpath(SELF:gsub("scripts/[^/]+$", "") .. "nvim/.config/nvim/lua/custom/agent_review.lua"))

local failures, checks = 0, 0
local function check(name, ok, detail)
	checks = checks + 1
	io.write((ok and "  ok   " or "  FAIL ") .. name .. ((not ok and detail) and ("  -- " .. tostring(detail)) or "") .. "\n")
	if not ok then failures = failures + 1 end
end

local function sh(cwd, cmd)
	local r = vim.system({ "sh", "-c", cmd }, { cwd = cwd, text = true }):wait()
	assert(r.code == 0, cmd .. "\n" .. (r.stderr or ""))
	return vim.trim(r.stdout or "")
end

local function tempdir()
	local dir = vim.fn.tempname()
	vim.fn.mkdir(dir, "p")
	return vim.uv.fs_realpath(dir)
end

local main = tempdir()
sh(main, "git init -q -b main && git config user.email a@b.c && git config user.name t")
sh(main, "printf '/.pi/agent-review/\\n' > .gitignore && printf 'one\\n' > agent.txt && git add -A && git commit -qm base")
sh(main, "git update-ref refs/remotes/origin/main HEAD")

local function worktree(branch)
	local path = tempdir() .. "/" .. branch
	sh(main, ("git worktree add -q -b %s %s"):format(branch, path))
	return path
end

-- A pending record in `tree`. With `edit`, the run changed agent.txt (not landed);
-- without, base == end, which the CLI reports as landed.
local function pending(tree, id, started, edit)
	local base = sh(tree, "git rev-parse HEAD")
	local stop = base
	if edit then
		sh(tree, "printf 'one\\n" .. edit .. "\\n' > agent.txt")
		local idx = vim.fn.tempname()
		local tree_id = sh(tree, ("GIT_INDEX_FILE=%s git add -A -- . && GIT_INDEX_FILE=%s git rm -r --cached --quiet --ignore-unmatch -- .pi && GIT_INDEX_FILE=%s git write-tree"):format(idx, idx, idx))
		stop = sh(tree, "git commit-tree " .. tree_id .. " -p " .. base .. " -m end")
	end
	vim.fn.mkdir(tree .. "/.pi/agent-review/pending", "p")
	vim.fn.writefile({ vim.json.encode({
		runId = id, base = base, ["end"] = stop,
		baseTree = sh(tree, "git rev-parse " .. base .. "^{tree}"), endTree = sh(tree, "git rev-parse " .. stop .. "^{tree}"),
		startedAt = started, files = { { file = "agent.txt" } }, name = vim.fs.basename(tree),
	}) }, tree .. "/.pi/agent-review/pending/" .. id .. ".json")
	sh(main, ("git update-ref refs/agent-review/%s/base %s && git update-ref refs/agent-review/%s/end %s"):format(id, base, id, stop))
	return base
end

local seen = {}
package.loaded["diffview"] = { open = function(args) seen.diffview = args end, close = function() end }
package.loaded["gitsigns"] = { change_base = function(rev) seen.base = rev end, reset_base = function() end }
local notices = {}
vim.notify = function(message, level) table.insert(notices, { message = message, level = level }) end
local function noticed(pattern, level)
	for _, n in ipairs(notices) do
		if n.message:match(pattern) and (level == nil or n.level == level) then return true end
	end
	return false
end

vim.fn.chdir(main)
local M = dofile(MODULE)

local ID = {
	stale = "aaaaaaaa-0000-4000-8000-000000000001",
	older = "bbbbbbbb-0000-4000-8000-000000000002",
	newer = "cccccccc-0000-4000-8000-000000000003",
	orphan = "dddddddd-0000-4000-8000-000000000004",
}

if CASE == "single_opens_owner" then
	pending(main, ID.stale, "2026-10-01T00:00:00Z", nil) -- stale and landed, in the root
	local wt = worktree("feat-one")
	local base = pending(wt, ID.older, "2026-10-10T00:00:00Z", "two")
	M.open()
	check("tab directory is the owner worktree", vim.fn.getcwd() == wt, vim.fn.getcwd())
	check("the worktree review opened, not the stale root record", M.current and M.current.runId == ID.older, vim.inspect(M.current))
	check("diffview opened at the worktree run's base", seen.diffview and seen.diffview[1] == base, vim.inspect(seen.diffview))
elseif CASE == "picker_order_and_tags" then
	pending(main, ID.stale, "2026-10-01T00:00:00Z", nil)
	local older = worktree("feat-older")
	pending(older, ID.older, "2026-10-10T00:00:00Z", "two")
	local newer = worktree("feat-newer")
	local newer_base = pending(newer, ID.newer, "2026-10-12T00:00:00Z", "three")
	sh(main, "git update-ref refs/agent-review/" .. ID.orphan .. "/base HEAD")
	local items, format, callback
	vim.ui.select = function(list, opts, cb) items, format, callback = list, opts.format_item, cb end
	M.open()
	check("several reviews open a picker", items ~= nil)
	local order = vim.tbl_map(function(e) return e.runId end, items or {})
	check("picker is oldest first, orphans last", vim.deep_equal(order, { ID.stale, ID.older, ID.newer, ID.orphan }), vim.inspect(order))
	check("the landed review is tagged", format and format(items[1]):match("%[landed%]") ~= nil, format and format(items[1]))
	check("a fresh review is not tagged landed", format and not format(items[2]):match("%[landed%]"), format and format(items[2]))
	check("the orphan is labelled with its skip command", format and format(items[4]):find("agent-review skip " .. ID.orphan, 1, true) ~= nil, format and format(items[4]))
	callback(items[4])
	check("an orphan cannot be opened", M.current == nil and noticed("cannot be opened", vim.log.levels.WARN), vim.inspect(notices))
	callback(items[3])
	check("picking a review opens it in its owner", M.current and M.current.runId == ID.newer and vim.fn.getcwd() == newer, vim.fn.getcwd())
	check("diffview opened at the picked run's base", seen.diffview and seen.diffview[1] == newer_base)
elseif CASE == "cli_failure_fallback" then
	pending(main, ID.older, "2026-10-10T00:00:00Z", "two")
	M.cli = "/nonexistent/agent-review"
	M.open()
	check("a CLI failure is reported", noticed("CLI unavailable", vim.log.levels.WARN), vim.inspect(notices))
	check("the current checkout is still reviewed", M.current and M.current.runId == ID.older, vim.inspect(M.current))
else
	io.write("unknown case: " .. tostring(CASE) .. "\n")
	os.exit(2)
end

io.write(("%d checks, %d failed\n"):format(checks, failures))
os.exit(failures == 0 and checks > 0 and 0 or 1)
