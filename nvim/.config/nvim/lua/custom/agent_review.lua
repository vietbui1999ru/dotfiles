if vim.g.vscode then return end

local M = { current = nil, notes = {} }
-- UUID v4: 8-4-4-4-12 hex groups; version nibble 4; variant nibble 8/9/a/b.
local UUID = "^%x%x%x%x%x%x%x%x%-%x%x%x%x%-4%x%x%x%-[89aAbB]%x%x%x%-%x%x%x%x%x%x%x%x%x%x%x%x$"
-- 40-char lowercase-or-uppercase hex hash (git object id).
local HASH = "^%x+$"
local HASH_LEN = 40

local function root()
  local buf = vim.api.nvim_buf_get_name(0)
  local cwd = vim.fn.getcwd()
  if buf ~= "" then
    local dir = vim.fn.fnamemodify(buf, ":h")
    local real = vim.uv.fs_realpath(dir)
    if real then cwd = real end
  end
  local result = vim.system({ "git", "rev-parse", "--show-toplevel" }, { cwd = cwd, text = true }):wait()
  assert(result.code == 0, result.stderr)
  return vim.trim(result.stdout)
end

local function valid_id(value) return type(value) == "string" and value:match(UUID) ~= nil end
local function valid_hash(value)
  return type(value) == "string" and #value == HASH_LEN and value:match(HASH) ~= nil
end

local function review_dir(repo) return repo .. "/.pi/agent-review" end

local function git(repo, args, opts)
  opts = opts or {}; opts.cwd = repo; opts.text = true
  local result = vim.system(vim.list_extend({ "git" }, args), opts):wait()
  assert(result.code == 0, result.stderr ~= "" and result.stderr or "git failed")
  return vim.trim(result.stdout)
end

-- Like git(), but preserves trailing newlines (patch output must keep its
-- final newline; trimming it corrupts the record).
local function git_raw(repo, args, opts)
  opts = opts or {}; opts.cwd = repo; opts.text = true
  local result = vim.system(vim.list_extend({ "git" }, args), opts):wait()
  assert(result.code == 0, result.stderr ~= "" and result.stderr or "git failed")
  return result.stdout
end

local function snapshot(repo, label)
  local index = git(repo, { "rev-parse", "--git-path", "index" })
  index = vim.fs.normalize(vim.fs.joinpath(repo, index))
  local temp = vim.fn.tempname() .. ".index"
  if vim.uv.fs_stat(index) then assert(vim.uv.fs_copyfile(index, temp)) end
  local env = vim.tbl_extend("force", vim.fn.environ(), { GIT_INDEX_FILE = temp })
  local ok, result = pcall(function()
    git(repo, { "add", "-A", "--", ".", ":(exclude).pi/agent-review" }, { env = env })
    local tree = git(repo, { "write-tree" }, { env = env })
    local commit = git(repo, { "commit-tree", tree, "-m", label }, { env = env })
    return { commit = commit, tree = tree }
  end)
  vim.fn.delete(temp)
  if not ok then error(result) end
  return result
end

local function read_json(path)
  local ok, lines = pcall(vim.fn.readfile, path)
  if not ok then return nil end
  local decoded, value = pcall(vim.json.decode, table.concat(lines, "\n"))
  return decoded and value or nil
end

local function atomic_json(path, value)
  vim.fn.mkdir(vim.fn.fnamemodify(path, ":h"), "p")
  local temp = path .. "." .. vim.fn.sha256(tostring(vim.uv.hrtime())):sub(1, 8) .. ".tmp"
  vim.fn.writefile({ vim.json.encode(value) }, temp)
  assert(vim.uv.fs_rename(temp, path))
end

local function pending(repo)
  local files = vim.fn.globpath(review_dir(repo) .. "/pending", "*.json", false, true)
  local valid = {}
  for _, file in ipairs(files) do
    local id = vim.fn.fnamemodify(file, ":t:r")
    local record = valid_id(id) and read_json(file) or nil
    if record and record.runId == id
        and valid_hash(record.base) and valid_hash(record["end"])
        and valid_hash(record.baseTree) and valid_hash(record.endTree) then
      table.insert(valid, { path = file, record = record })
    end
  end
  table.sort(valid, function(a, b) return a.record.startedAt < b.record.startedAt end)
  return valid
end

-- Resolve the repo-root-relative path of the file under the cursor.
-- Diffview buffer names look like diffview:///abs/.git/<rev>/path or
-- diffview:///abs/.git/<rev>/WORKTREE/path; the revision marker separates
-- the git directory from the repo-relative file path.
local function real_file(repo)
  local name = vim.api.nvim_buf_get_name(0)
  if name:match("^diffview://") then
    local path = name:gsub("^diffview://", "")
    local hash_marker = "/" .. string.rep("%x", 40) .. "/(.+)$"
    local rel = path:match(hash_marker)
    if rel then return rel end
    for _, marker in ipairs({ "/LOCAL/", "/WORKTREE/", "/local/" }) do
      local i = path:find(marker, 1, true)
      if i then return path:sub(i + #marker) end
    end
    error("Could not resolve repo-relative path from diffview buffer: " .. name)
  end
  local absolute = vim.fs.normalize(name)
  local real_abs = vim.uv.fs_realpath(absolute) or absolute
  local real_repo = vim.uv.fs_realpath(repo) or repo
  local prefix = real_repo .. "/"
  if real_abs:sub(1, #prefix) ~= prefix then
    error("Buffer path " .. real_abs .. " is not inside repo " .. real_repo)
  end
  return real_abs:sub(#prefix + 1)
end

function M.open()
  local ok, err = pcall(function()
    local repo = root()
    local entry = pending(repo)[1]
    if not entry then return vim.notify("No pending agent review", vim.log.levels.INFO) end
    local record = entry.record
    assert(valid_hash(record.base), "invalid base in pending record")
    M.current, M.notes = record, {}
    require("diffview").open({ record.base })
    require("gitsigns").change_base(record.base, true)
    vim.notify("Accept: leave hunk. Reject: :Gitsigns reset_hunk. Edit normally.")
  end)
  if not ok then vim.notify("AgentReview failed: " .. tostring(err), vim.log.levels.ERROR) end
end

function M.note()
  if not M.current then return vim.notify("Open :AgentReview first", vim.log.levels.WARN) end
  local repo = root()
  vim.ui.input({ prompt = "Agent review note: " }, function(note)
    local ok, err = pcall(function()
      if not note or note == "" then return end
      local name = vim.api.nvim_buf_get_name(0)
      local file, line
      if name:match("^diffview://") and name:match("DiffviewFilePanel$") then
        -- The panel has no repo-relative path of its own, so ask the panel which
        -- entry its cursor is on. get_item_at_cursor() reads the cursor out of
        -- the panel's own window id, so it holds however focus is reported.
        --
        -- The two obvious alternatives are both wrong here. panel.cur_file is
        -- whichever file is *open* in the diff, updated only by set_file,
        -- next_file, prev_file and the staging actions. view:infer_cur_file()
        -- means well, but falls back to that same open file whenever
        -- panel:is_focused() is false — observed live while working the panel,
        -- and it files the note against the wrong path with no error.
        local view = require("diffview.lib").get_current_view()
        local panel = view and view.panel
        local selected = panel and panel.get_item_at_cursor and panel:get_item_at_cursor()
        -- Directory nodes carry `collapsed`; they name no single file.
        if selected and type(selected.collapsed) == "boolean" then selected = nil end
        file = selected and selected.path
        -- A panel entry names a file, not a position in it.
        line = 0
      else
        file = real_file(repo)
        line = vim.fn.line(".")
      end
      if not file then
        error("Could not determine the file for the note. Move the cursor to a file diff pane.")
      end
      table.insert(M.notes, { file = file, line = line, note = note })
    end)
    if not ok then vim.notify("AgentReviewNote failed: " .. tostring(err), vim.log.levels.ERROR) end
  end)
end

function M.done()
  local ok, err = pcall(function()
    assert(M.current, "Open :AgentReview first")
    local repo, record = root(), M.current
    assert(
      valid_id(record.runId) and valid_hash(record.endTree) and valid_hash(record.base),
      "invalid pending record"
    )
    local final = snapshot(repo, "agent-review-final")
    -- Scope the diff to the files this run touched. The working tree is shared:
    -- another session, or you in a second window, may have edited something
    -- unrelated since the run ended, and that work is not part of this decision.
    -- Without the pathspec it lands in the patch the agent is told to read,
    -- while every reviewed file still reports "accepted".
    local paths = {}
    for _, item in ipairs(record.files or {}) do
      if type(item.file) == "string" then table.insert(paths, item.file) end
    end
    local patch, changed = "", {}
    if #paths > 0 then
      patch = git_raw(repo, vim.list_extend({ "diff", record.endTree, final.tree, "--" }, vim.deepcopy(paths)))
      local names = git(repo, vim.list_extend({ "diff", "--name-only", record.endTree, final.tree, "--" }, vim.deepcopy(paths)))
      for _, file in ipairs(vim.split(names, "\n", { trimempty = true })) do
        changed[file] = true
      end
    end
    local files = {}
    for _, item in ipairs(record.files or {}) do
      table.insert(files, { file = item.file, status = changed[item.file] and "changed" or "accepted" })
    end
    atomic_json(review_dir(repo) .. "/decisions/" .. record.runId .. ".json", {
      runId = record.runId, endTree = record.endTree, finalTree = final.tree,
      files = files, notes = M.notes, patch = patch,
    })
    require("diffview").close()
    require("gitsigns").reset_base(true)
    M.current, M.notes = nil, {}
    -- An all-accepted decision is legitimate, but it is also what a rejection
    -- that never landed looks like: :Gitsigns reset_hunk is a silent no-op on
    -- any buffer gitsigns is not attached to, which includes the file panel and
    -- the base side of the diff. Say so, rather than reporting plain success
    -- and letting the agent keep changes you meant to throw away.
    if patch == "" then
      vim.notify(
        "Agent review: nothing was rejected or edited; recorded an all-accepted decision. "
          .. "To reject a hunk, run :Gitsigns reset_hunk from the working-tree side of the diff.",
        vim.log.levels.WARN
      )
    else
      vim.notify("Agent review decision recorded; Pi will validate and clear pending")
    end
  end)
  if not ok then vim.notify("AgentReviewDone failed: " .. tostring(err), vim.log.levels.ERROR) end
end

vim.api.nvim_create_user_command("AgentReview", M.open, {})
vim.api.nvim_create_user_command("AgentReviewNote", M.note, {})
vim.api.nvim_create_user_command("AgentReviewDone", M.done, {})
vim.keymap.set("n", "<leader>ar", M.open, { desc = "Agent: review run" })
vim.keymap.set("n", "<leader>an", M.note, { desc = "Agent: review note" })
vim.keymap.set("n", "<leader>aD", M.done, { desc = "Agent: review done" })
return M
