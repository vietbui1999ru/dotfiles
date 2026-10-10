-- Headless verification harness for the Neovim half of agent-review.
--
-- It drives agent_review.lua against a throwaway git repo with diffview and
-- gitsigns stubbed out, so the decision record, the arguments handed to those
-- plugins, and the pending-record validation are all checked without a human
-- at the keyboard. What it cannot check is how the diff actually renders and
-- whether :Gitsigns reset_hunk edits the right lines; those stay manual.
--
-- Run from the repo root:
--   nvim --clean --headless -l scripts/agent-review-nvim-test.lua
local MODULE = arg[1]
  or debug.getinfo(1, "S").source:sub(2):gsub("scripts/[^/]+$", "")
    .. "nvim/.config/nvim/lua/custom/agent_review.lua"
-- Resolve now: the checks below chdir into a throwaway repo.
MODULE = assert(vim.uv.fs_realpath(MODULE), "cannot find agent_review.lua at " .. MODULE)

local DEBUG = os.getenv("AGENT_REVIEW_DEBUG") == "1"
local START = vim.uv.hrtime()
local function dlog(fmt, ...)
  if DEBUG then io.write("[debug] " .. fmt:format(...) .. "\n") end
end

local function elapsed_ms()
  return math.floor((vim.uv.hrtime() - START) / 1e6)
end

local failures, checks = {}, 0
local function check(name, ok, detail)
  checks = checks + 1
  if ok then
    io.write("  ok   " .. name .. "\n")
    if DEBUG and detail then dlog("%s detail: %s", name, tostring(detail)) end
  else
    io.write("  FAIL " .. name .. (detail and ("  -- " .. tostring(detail)) or "") .. "\n")
    table.insert(failures, name)
  end
end

local function sh(cwd, cmd)
  local r = vim.system({ "sh", "-c", cmd }, { cwd = cwd, text = true }):wait()
  assert(r.code == 0, cmd .. "\n" .. (r.stderr or ""))
  return vim.trim(r.stdout or "")
end

-- A repo whose HEAD is the run's base, with uncommitted "agent" edits on top.
local function fixture()
  local repo = vim.fn.tempname()
  vim.fn.mkdir(repo, "p")
  repo = vim.uv.fs_realpath(repo)
  sh(repo, "git init -q -b main && git config user.email a@b.c && git config user.name t")
  -- The spec tells every repo to ignore the review's own state, and git refuses
  -- an `:(exclude)` pathspec that names an ignored path which exists on disk.
  -- The fixture carries the rule so the snapshot is exercised as deployed.
  sh(repo, "printf '/.pi/agent-review/\\n' > .gitignore")
  sh(repo, "printf 'keep\\n' > keep.txt && printf 'one\\n' > agent.txt")
  sh(repo, "git add -A && git commit -qm base")
  local base = sh(repo, "git rev-parse HEAD")
  dlog("fixture base = %s", base)
  -- The agent's work: one edited file, one new file.
  sh(repo, "printf 'one\\ntwo\\n' > agent.txt && printf 'new\\n' > added.txt")
  return repo, base
end

-- Snapshot the working tree the way the extension does, into a scratch index.
local function snapshot(repo, label)
  local idx = vim.fn.tempname() .. ".index"
  local env = "GIT_INDEX_FILE=" .. idx
  sh(repo, env .. " git add -A -- .")
  sh(repo, env .. " git rm -r --cached --quiet --ignore-unmatch -- .pi")
  local tree = sh(repo, env .. " git write-tree")
  local commit = sh(repo, env .. " git commit-tree " .. tree .. " -m " .. label)
  vim.fn.delete(idx)
  return { tree = tree, commit = commit }
end

local repo, base = fixture()
local endsnap = snapshot(repo, "end")
local runId = "11111111-2222-4333-8444-555555555555"

vim.fn.mkdir(repo .. "/.pi/agent-review/pending", "p")
vim.fn.writefile({ vim.json.encode({
  runId = runId,
  base = base,
  ["end"] = endsnap.commit,
  baseTree = sh(repo, "git rev-parse HEAD^{tree}"),
  endTree = endsnap.tree,
  startedAt = "2026-09-18T00:00:00Z",
  files = { { file = "agent.txt" }, { file = "added.txt" } },
}) }, repo .. "/.pi/agent-review/pending/" .. runId .. ".json")

-- Stub the two plugins the module drives, recording exactly what it passed.
local seen = { diffview_open = nil, change_base = nil, reset_base = nil, closed = false }
package.loaded["diffview"] = {
  open = function(args) seen.diffview_open = args end,
  close = function() seen.closed = true end,
}
package.loaded["gitsigns"] = {
  change_base = function(rev, global) seen.change_base = { rev, global } end,
  reset_base = function(global) seen.reset_base = { global } end,
}

vim.fn.chdir(repo)
local M = dofile(MODULE)

-- Capture notifications: some of what the module must tell the reviewer is only
-- ever said through vim.notify, and a wrong message there is a real defect.
local notices = {}
vim.notify = function(message, level) table.insert(notices, { message = message, level = level }) end
local function noticed(pattern, level)
  for _, notice in ipairs(notices) do
    if notice.message:match(pattern) and (level == nil or notice.level == level) then return notice end
  end
end

io.write("\nopen\n")
M.open()
-- added.txt did not exist at the run's base, so reset_hunk has nothing to
-- revert to; the reviewer has to be told to delete it instead.
check("new files are named as unrejectable", noticed("added%.txt.* new", vim.log.levels.WARN) ~= nil, vim.inspect(notices))
check("files present in the base are not named", noticed("agent%.txt.* new") == nil, vim.inspect(notices))
-- Unscoped, diffview lists every difference between the base and the working
-- tree, so the panel offers files the run never touched — and the reviewer can
-- spend the review rejecting somebody else's work. Observed live.
check("diffview is scoped to the run's files",
  vim.deep_equal(seen.diffview_open, { base, "--", "agent.txt", "added.txt" }), vim.inspect(seen.diffview_open))
check("gitsigns.change_base pinned globally", vim.deep_equal(seen.change_base, { base, true }), vim.inspect(seen.change_base))
check("pending record became current", M.current ~= nil and M.current.runId == runId)
check("status reports the open review", M.status():match("review " .. runId:sub(1, 8)) ~= nil, M.status())

io.write("\nnote\n")
-- The reviewer's cursor sits in a real file buffer inside the repo.
vim.cmd.edit(repo .. "/agent.txt")
vim.ui.input = function(_, on_confirm) on_confirm("second line is wrong") end
M.note()
check("note recorded a repo-root-relative path", M.notes[1] and M.notes[1].file == "agent.txt", vim.inspect(M.notes))
M.clear_notes()
check("clear_notes empties the note list", #M.notes == 0)
check("clear_notes is reported", noticed("notes cleared") ~= nil, vim.inspect(notices))
-- Re-add the note so the later decision check still finds it.
M.note()

io.write("\nreject\n")
-- Rejection must not depend on gitsigns: it attaches to neither untracked files
-- nor diffview's virtual buffers, and reset_hunk returns silently when it
-- cannot act. :AgentReviewReject restores from the base tree instead.
M.reject("added.txt")
check("a file the run created is deleted", vim.uv.fs_stat(repo .. "/added.txt") == nil)
check("deleting is reported as a rejection", noticed("Rejected added%.txt") ~= nil, vim.inspect(notices))
M.reject("agent.txt")
check("a file present in the base is restored to it", sh(repo, "cat agent.txt") == "one", sh(repo, "cat agent.txt"))
notices = {}
M.reject("keep.txt")
check("a file outside the review is refused", noticed("not part of this review") ~= nil, vim.inspect(notices))
check("the refused file is untouched", sh(repo, "cat keep.txt") == "keep")

-- Rejecting restores the whole file, so work written into it after the run
-- ended — the reviewer's own, usually — would go with it.
sh(repo, "printf 'one\\nmine\\n' > agent.txt")
notices = {}
M.reject("agent.txt")
check("rejecting a file edited since the run is refused", noticed("changed after the run ended") ~= nil, vim.inspect(notices))
check("the reviewer's later edits survive", sh(repo, "cat agent.txt") == "one\nmine", sh(repo, "cat agent.txt"))
notices = {}
M.reject("agent.txt", true)
check("the bang override rejects anyway", sh(repo, "cat agent.txt") == "one", sh(repo, "cat agent.txt"))

-- Pi rewrites .pi/status/<id>.json during every run. If the reviewer's final
-- snapshot counted it, the decision would carry a change the agent never made.
sh(repo, "mkdir -p .pi/status && printf '{}' > .pi/status/session.json")

io.write("\ndone\n")
-- agent.txt is already reverted by the rejection above; added.txt is gone.
-- Meanwhile something outside the run's file list changes: another session, or
-- the reviewer in a second window. It is not part of this decision.
sh(repo, "printf 'unrelated\\n' > keep.txt")
M.done()

local decision = vim.json.decode(table.concat(vim.fn.readfile(repo .. "/.pi/agent-review/decisions/" .. runId .. ".json"), "\n"))
check("decision carries the pending runId", decision.runId == runId)
check("decision echoes endTree", decision.endTree == endsnap.tree)
check("finalTree differs from endTree after reviewer edits", decision.finalTree ~= endsnap.tree)
check("rejected file marked changed", vim.deep_equal(decision.files[1], { file = "agent.txt", status = "changed" }), vim.inspect(decision.files))
-- Both files were rejected above, the second by deletion; a deleted file is a
-- change like any other. The accepted case is covered in "all-accepted" below.
check("a deleted file is marked changed", vim.deep_equal(decision.files[2], { file = "added.txt", status = "changed" }), vim.inspect(decision.files))
check("patch keeps its trailing newline", decision.patch:sub(-1) == "\n", vim.inspect(decision.patch:sub(-20)))
check("patch contains the reverted hunk", decision.patch:match("agent%.txt") ~= nil)
check("patch excludes files outside the run", decision.patch:match("keep%.txt") == nil, decision.patch)
-- The patch is scoped to the run's files, so this has to be checked against the
-- tree itself: Pi's own state must never enter a snapshot in the first place.
local final_tree = sh(repo, "git ls-tree -r --name-only " .. decision.finalTree)
check("Pi's own state is absent from the final tree", final_tree:match("%.pi/") == nil, final_tree)
check("notes survived into the decision", decision.notes[1] and decision.notes[1].file == "agent.txt")
check("diffview closed", seen.closed)
check("gitsigns base reset globally", vim.deep_equal(seen.reset_base, { true }))
check("current cleared", M.current == nil)
check("pending record left for Pi to clear", vim.uv.fs_stat(repo .. "/.pi/agent-review/pending/" .. runId .. ".json") ~= nil)

check("recording real reviewer changes reports success", noticed("decision recorded") ~= nil, vim.inspect(notices))

io.write("\nall-accepted\n")
-- A review where the reviewer changes nothing is legitimate, but it is also
-- indistinguishable from a rejection that silently failed to land. The reviewer
-- must be told which one happened.
sh(repo, "rm " .. repo .. "/.pi/agent-review/pending/" .. runId .. ".json")
local quiet = snapshot(repo, "quiet")
local quietId = "22222222-3333-4444-8555-666666666666"
vim.fn.writefile({ vim.json.encode({
  runId = quietId,
  base = base,
  ["end"] = quiet.commit,
  baseTree = sh(repo, "git rev-parse HEAD^{tree}"),
  endTree = quiet.tree,
  startedAt = "2026-09-18T01:00:00Z",
  files = { { file = "agent.txt" } },
}) }, repo .. "/.pi/agent-review/pending/" .. quietId .. ".json")

notices = {}
M.open()
M.done()
local quietDecision = vim.json.decode(table.concat(vim.fn.readfile(repo .. "/.pi/agent-review/decisions/" .. quietId .. ".json"), "\n"))
check("an untouched review records an empty patch", quietDecision.patch == "", vim.inspect(quietDecision.patch))
check("every file is accepted", vim.deep_equal(quietDecision.files, { { file = "agent.txt", status = "accepted" } }), vim.inspect(quietDecision.files))
check("the reviewer is warned that nothing was rejected", noticed("nothing was rejected", vim.log.levels.WARN) ~= nil, vim.inspect(notices))
check("success is not also reported", noticed("decision recorded") == nil, vim.inspect(notices))

io.write("\nreview in another worktree\n")
-- Reviews live in <worktree>/.pi/agent-review. Opened from a checkout that has
-- none, :AgentReview must find the one waiting in a sibling worktree.
local quiet_file = repo .. "/.pi/agent-review/pending/" .. quietId .. ".json"
sh(repo, "mv " .. quiet_file .. " " .. quiet_file .. ".aside")
local wt = repo .. "-sibling"
sh(repo, "git worktree add -q -b sibling " .. wt)
vim.fn.mkdir(wt .. "/.pi/agent-review/pending", "p")
local siblingId = "33333333-4444-4555-8666-777777777777"
vim.fn.writefile({ vim.json.encode({
  runId = siblingId,
  base = base,
  ["end"] = quiet.commit,
  baseTree = sh(repo, "git rev-parse HEAD^{tree}"),
  endTree = quiet.tree,
  startedAt = "2026-09-18T02:00:00Z",
  files = { { file = "agent.txt" } },
}) }, wt .. "/.pi/agent-review/pending/" .. siblingId .. ".json")
notices = {}
M.current = nil
M.open()
check("a review in a sibling worktree is found", M.current ~= nil and M.current.runId == siblingId, vim.inspect(M.current))
check("the tab directory moves to that worktree", vim.uv.fs_realpath(vim.fn.getcwd()) == vim.uv.fs_realpath(wt), vim.fn.getcwd())
check("the move is reported", noticed("is in worktree") ~= nil, vim.inspect(notices))
vim.cmd.tcd(vim.fn.fnameescape(repo))
M.current = nil
sh(repo, "mv " .. quiet_file .. ".aside " .. quiet_file)
-- Later checks expect a repo with no valid review beyond their own fixtures.
sh(repo, "git worktree remove --force " .. wt)

io.write("\ndiffview buffers\n")
-- Notes are usually taken from a diffview buffer, whose name is virtual: the
-- module must still find the repo root and a repo-relative path from it.
local function note_from(name)
  M.current, M.notes = { runId = runId, base = base, endTree = endsnap.tree }, {}
  local existing = vim.fn.bufnr(name)
  if existing ~= -1 then vim.api.nvim_buf_delete(existing, { force = true }) end
  local buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_name(buf, name)
  vim.api.nvim_set_current_buf(buf)
  M.note()
  return M.notes[1]
end
local hashed = note_from("diffview://" .. repo .. "/.git/" .. string.rep("a", 40) .. "/agent.txt")
check("path resolved from a revision-hashed diffview buffer", hashed and hashed.file == "agent.txt", vim.inspect(hashed))
local worktree = note_from("diffview://" .. repo .. "/.git/WORKTREE/agent.txt")
check("path resolved from a WORKTREE diffview buffer", worktree and worktree.file == "agent.txt", vim.inspect(worktree))

-- Taking a note from the file panel must follow the cursor. diffview keeps two
-- different notions of "current file": panel.cur_file is whatever is *open* in
-- the diff, updated only by set_file/next_file/prev_file and the staging
-- actions, while the panel's own cursor may sit on a different entry entirely.
--
-- view:infer_cur_file() reconciles them, but only when panel:is_focused() says
-- the panel window is the current one. Observed in a real session: it can be
-- false while the reviewer is working the panel, and the fallback then returns
-- the open file. panel:get_item_at_cursor() reads the cursor straight out of
-- the panel's own window id, so it holds regardless of focus. These stubs make
-- the two disagree exactly as they did live.
local function stub_diffview(item)
  package.loaded["diffview.lib"] = {
    get_current_view = function()
      return {
        panel = { cur_file = { path = "added.txt" }, get_item_at_cursor = function() return item end },
        -- The unfocused fallback: whatever is open in the diff.
        infer_cur_file = function() return { path = "added.txt" } end,
      }
    end,
  }
end

stub_diffview({ path = "agent.txt" })
local panel = note_from("diffview:///panels/0/DiffviewFilePanel")
check("note from the file panel follows the cursor, not the open file", panel and panel.file == "agent.txt", vim.inspect(panel))

-- A directory node carries `collapsed` and names no single file. The note must
-- be refused rather than silently attached to whichever file happens to be open.
stub_diffview({ path = "subdir", collapsed = false })
local dir = note_from("diffview:///panels/0/DiffviewFilePanel")
check("note is refused on a directory node", dir == nil, vim.inspect(dir))

stub_diffview(nil)
local none = note_from("diffview:///panels/0/DiffviewFilePanel")
check("note is refused when the cursor is on no file", none == nil, vim.inspect(none))
vim.cmd.edit(repo .. "/agent.txt")
M.current, M.notes = nil, {}

io.write("\nrejections\n")
-- A record whose filename and runId disagree must be ignored entirely.
local bad = "99999999-2222-4333-8444-555555555555"
vim.fn.writefile({ vim.json.encode({ runId = runId, base = base, ["end"] = endsnap.commit, baseTree = base, endTree = endsnap.tree, startedAt = "x" }) },
  repo .. "/.pi/agent-review/pending/" .. bad .. ".json")
-- Clear the valid record left from the previous section so only the bad one remains.
sh(repo, "rm " .. repo .. "/.pi/agent-review/pending/" .. quietId .. ".json")
seen.diffview_open = nil
M.open()
check("mismatched runId/filename is ignored", seen.diffview_open == nil and M.current == nil, vim.inspect(seen.diffview_open))

-- A non-UUID name must never reach a path.
sh(repo, "rm " .. repo .. "/.pi/agent-review/pending/" .. bad .. ".json")
vim.fn.writefile({ vim.json.encode({ runId = "../../escape", base = base }) }, repo .. "/.pi/agent-review/pending/../../escape.json")
M.open()
check("non-UUID pending name is ignored", M.current == nil)

io.write("\nreject all\n")
-- :AgentReviewRejectAll is all-or-nothing and fails closed; each case builds its
-- own repo, with the agent's edits from fixture() on top of the base.
local function ra_fixture(n, files, opts)
  opts = opts or {}
  local r, b = fixture()
  if opts.base_cmd then
    sh(r, opts.base_cmd)
    sh(r, "git add -A -- " .. opts.base_path .. " && git commit -qm base2")
    b = sh(r, "git rev-parse HEAD")
  end
  if opts.pre then sh(r, opts.pre) end
  local snap = snapshot(r, "end")
  local id = ("aaaaaaaa-1111-4111-8111-%012d"):format(n)
  vim.fn.mkdir(r .. "/.pi/agent-review/pending", "p")
  vim.fn.writefile({ vim.json.encode({
    runId = id, base = b, ["end"] = snap.commit,
    baseTree = sh(r, "git rev-parse HEAD^{tree}"), endTree = snap.tree,
    startedAt = "2026-09-18T00:00:00Z", files = files,
  }) }, r .. "/.pi/agent-review/pending/" .. id .. ".json")
  vim.cmd.tcd(vim.fn.fnameescape(r))
  vim.cmd.enew()
  M.current, M.notes = nil, {}
  notices = {}
  return r, id
end
local function ra_decision(r, id)
  local f = r .. "/.pi/agent-review/decisions/" .. id .. ".json"
  if vim.uv.fs_stat(f) == nil then return nil end
  return vim.json.decode(table.concat(vim.fn.readfile(f), "\n"))
end
local function ra_end(r)
  vim.cmd.tcd(vim.fn.fnameescape(repo))
  M.current, M.notes = nil, {}
  sh(repo, "rm -rf " .. r)
end
local both = { { file = "agent.txt" }, { file = "added.txt" } }

check("RA1 command is registered", vim.fn.exists(":AgentReviewRejectAll") == 2)

local function ra_rejected(name, r, id)
  local d = ra_decision(r, id)
  check(name .. " agent.txt restored", sh(r, "cat agent.txt") == "one", sh(r, "cat agent.txt"))
  check(name .. " added.txt removed", vim.uv.fs_stat(r .. "/added.txt") == nil)
  check(name .. " keep.txt untouched", sh(r, "cat keep.txt") == "keep")
  check(name .. " decision lists both as changed", d ~= nil and vim.deep_equal(d.files,
    { { file = "agent.txt", status = "changed" }, { file = "added.txt", status = "changed" } }), vim.inspect(d))
  check(name .. " patch non-empty, nothing skipped", d ~= nil and d.patch ~= "" and d.skipped == nil)
  check(name .. " review closed", M.current == nil)
end

local r, id = ra_fixture(2, both)
vim.cmd("AgentReviewRejectAll")
ra_rejected("RA2", r, id)
ra_end(r)

r, id = ra_fixture(3, both)
vim.cmd("AgentReviewRejectAll " .. id)
ra_rejected("RA3", r, id)
ra_end(r)

r, id = ra_fixture(4, both)
vim.cmd("AgentReviewRejectAll bbbbbbbb-1111-4111-8111-000000000004")
check("RA4 agent.txt untouched", sh(r, "cat agent.txt") == "one\ntwo", sh(r, "cat agent.txt"))
check("RA4 added.txt still present", vim.uv.fs_stat(r .. "/added.txt") ~= nil)
check("RA4 no decision", ra_decision(r, id) == nil)
check("RA4 refusal reported", noticed("nothing was rejected", vim.log.levels.ERROR) ~= nil, vim.inspect(notices))
ra_end(r)

r, id = ra_fixture(5, both, { })
sh(r, "printf 'one\\nmine\\n' > agent.txt")
vim.cmd("AgentReviewRejectAll")
check("RA5 refused, added.txt still exists (all or nothing)", vim.uv.fs_stat(r .. "/added.txt") ~= nil)
check("RA5 reviewer's edit survives", sh(r, "cat agent.txt") == "one\nmine", sh(r, "cat agent.txt"))
check("RA5 no decision, review still open", ra_decision(r, id) == nil and M.current ~= nil)
check("RA5 refusal reported", noticed("nothing was rejected", vim.log.levels.ERROR) ~= nil, vim.inspect(notices))
ra_end(r)

r, id = ra_fixture(6, both)
vim.cmd.edit(vim.fn.fnameescape(r .. "/agent.txt"))
vim.api.nvim_buf_set_lines(0, 0, -1, false, { "unsaved" })
vim.cmd("AgentReviewRejectAll")
check("RA6 unsaved buffer refused, no decision", ra_decision(r, id) == nil and vim.uv.fs_stat(r .. "/added.txt") ~= nil)
check("RA6 refusal reported", noticed("unsaved edits", vim.log.levels.ERROR) ~= nil, vim.inspect(notices))
vim.cmd("bwipeout!")
ra_end(r)

r, id = ra_fixture(7, { { file = "agent.txt" }, { file = "added.txt" }, { file = "keep.txt" } }, { pre = "rm keep.txt" })
vim.cmd("AgentReviewRejectAll")
check("RA7 deleted keep.txt restored", vim.uv.fs_stat(r .. "/keep.txt") ~= nil and sh(r, "cat keep.txt") == "keep")
check("RA7 decision recorded", ra_decision(r, id) ~= nil and M.current == nil)
ra_end(r)

local e8 = vim.fn.tempname()
vim.fn.mkdir(e8, "p")
e8 = vim.uv.fs_realpath(e8)
sh(e8, "git init -q -b main")
vim.cmd.tcd(vim.fn.fnameescape(e8))
vim.cmd.enew()
M.current, notices = nil, {}
vim.cmd("AgentReviewRejectAll")
check("RA8 no pending review reported", noticed("AgentReviewRejectAll failed", vim.log.levels.ERROR) ~= nil, vim.inspect(notices))
check("RA8 no decisions dir", vim.uv.fs_stat(e8 .. "/.pi/agent-review/decisions") == nil)
vim.cmd.tcd(vim.fn.fnameescape(repo))
sh(repo, "rm -rf " .. e8)

r, id = ra_fixture(9, { { file = "agent.txt" }, { file = "sub/x.txt" } },
  { base_cmd = "mkdir -p sub && printf 'a\\n' > sub/x.txt", base_path = "sub/x.txt",
    pre = "printf 'b\\n' > sub/x.txt" })
sh(r, "chmod 444 sub/x.txt")
vim.cmd("AgentReviewRejectAll")
sh(r, "chmod 644 sub/x.txt")
check("RA9 rolled back agent.txt to the run's version", sh(r, "cat agent.txt") == "one\ntwo", sh(r, "cat agent.txt"))
check("RA9 sub/x.txt unchanged", sh(r, "cat sub/x.txt") == "b", sh(r, "cat sub/x.txt"))
check("RA9 no decision", ra_decision(r, id) == nil)
check("RA9 failure names the file", noticed("sub/x%.txt", vim.log.levels.ERROR) ~= nil, vim.inspect(notices))
ra_end(r)

sh(repo, "rm -rf " .. repo)
io.write(("\n%d checks, %d failed in %d ms\n"):format(checks, #failures, elapsed_ms()))
for _, f in ipairs(failures) do io.write("  - " .. f .. "\n") end
-- `nvim -l` ignores :cquit's exit code, so exit through Lua instead.
io.flush()
os.exit(#failures == 0 and 0 or 1)
