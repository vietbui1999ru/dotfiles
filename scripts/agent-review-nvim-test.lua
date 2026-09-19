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

local failures, checks = {}, 0
local function check(name, ok, detail)
  checks = checks + 1
  if ok then
    io.write("  ok   " .. name .. "\n")
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
  sh(repo, "printf 'keep\\n' > keep.txt && printf 'one\\n' > agent.txt")
  sh(repo, "git add -A && git commit -qm base")
  local base = sh(repo, "git rev-parse HEAD")
  -- The agent's work: one edited file, one new file.
  sh(repo, "printf 'one\\ntwo\\n' > agent.txt && printf 'new\\n' > added.txt")
  return repo, base
end

-- Snapshot the working tree the way the extension does, into a scratch index.
local function snapshot(repo, label)
  local idx = vim.fn.tempname() .. ".index"
  local env = "GIT_INDEX_FILE=" .. idx
  sh(repo, env .. " git add -A -- . ':(exclude).pi/agent-review'")
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

io.write("\nopen\n")
M.open()
check("diffview.open got a positional revision", vim.deep_equal(seen.diffview_open, { base }), vim.inspect(seen.diffview_open))
check("gitsigns.change_base pinned globally", vim.deep_equal(seen.change_base, { base, true }), vim.inspect(seen.change_base))
check("pending record became current", M.current ~= nil and M.current.runId == runId)

io.write("\nnote\n")
-- The reviewer's cursor sits in a real file buffer inside the repo.
vim.cmd.edit(repo .. "/agent.txt")
vim.ui.input = function(_, on_confirm) on_confirm("second line is wrong") end
M.note()
check("note recorded a repo-root-relative path", M.notes[1] and M.notes[1].file == "agent.txt", vim.inspect(M.notes))

io.write("\ndone\n")
-- The reviewer rejects the agent's edit to agent.txt and leaves added.txt alone.
sh(repo, "printf 'one\\n' > agent.txt")
M.done()

local decision = vim.json.decode(table.concat(vim.fn.readfile(repo .. "/.pi/agent-review/decisions/" .. runId .. ".json"), "\n"))
check("decision carries the pending runId", decision.runId == runId)
check("decision echoes endTree", decision.endTree == endsnap.tree)
check("finalTree differs from endTree after reviewer edits", decision.finalTree ~= endsnap.tree)
check("rejected file marked changed", vim.deep_equal(decision.files[1], { file = "agent.txt", status = "changed" }), vim.inspect(decision.files))
check("untouched file marked accepted", vim.deep_equal(decision.files[2], { file = "added.txt", status = "accepted" }), vim.inspect(decision.files))
check("patch keeps its trailing newline", decision.patch:sub(-1) == "\n", vim.inspect(decision.patch:sub(-20)))
check("patch contains the reverted hunk", decision.patch:match("agent%.txt") ~= nil)
check("notes survived into the decision", decision.notes[1] and decision.notes[1].file == "agent.txt")
check("diffview closed", seen.closed)
check("gitsigns base reset globally", vim.deep_equal(seen.reset_base, { true }))
check("current cleared", M.current == nil)
check("pending record left for Pi to clear", vim.uv.fs_stat(repo .. "/.pi/agent-review/pending/" .. runId .. ".json") ~= nil)

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
sh(repo, "rm " .. repo .. "/.pi/agent-review/pending/" .. runId .. ".json")
seen.diffview_open = nil
M.open()
check("mismatched runId/filename is ignored", seen.diffview_open == nil and M.current == nil, vim.inspect(seen.diffview_open))

-- A non-UUID name must never reach a path.
sh(repo, "rm " .. repo .. "/.pi/agent-review/pending/" .. bad .. ".json")
vim.fn.writefile({ vim.json.encode({ runId = "../../escape", base = base }) }, repo .. "/.pi/agent-review/pending/../../escape.json")
M.open()
check("non-UUID pending name is ignored", M.current == nil)

sh(repo, "rm -rf " .. repo)
io.write(("\n%d checks, %d failed\n"):format(checks, #failures))
for _, f in ipairs(failures) do io.write("  - " .. f .. "\n") end
-- `nvim -l` ignores :cquit's exit code, so exit through Lua instead.
io.flush()
os.exit(#failures == 0 and 0 or 1)
