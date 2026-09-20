if vim.g.vscode then
	return
end

local M = { current = nil, notes = {}, verbose = false }

local function vlog(fmt, ...)
	if M.verbose then
		vim.notify("[agent-review] " .. fmt:format(...), vim.log.levels.DEBUG)
	end
end
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
		if real then
			cwd = real
		end
	end
	local result = vim.system({ "git", "rev-parse", "--show-toplevel" }, { cwd = cwd, text = true }):wait()
	assert(result.code == 0, result.stderr)
	return vim.trim(result.stdout)
end

local function valid_id(value)
	return type(value) == "string" and value:match(UUID) ~= nil
end
local function valid_hash(value)
	return type(value) == "string" and #value == HASH_LEN and value:match(HASH) ~= nil
end

local function review_dir(repo)
	return repo .. "/.pi/agent-review"
end

local function git(repo, args, opts)
	opts = opts or {}
	opts.cwd = repo
	opts.text = true
	local result = vim.system(vim.list_extend({ "git" }, args), opts):wait()
	assert(result.code == 0, result.stderr ~= "" and result.stderr or "git failed")
	return vim.trim(result.stdout)
end

-- Like git(), but preserves trailing newlines (patch output must keep its
-- final newline; trimming it corrupts the record).
local function git_raw(repo, args, opts)
	opts = opts or {}
	opts.cwd = repo
	opts.text = true
	local result = vim.system(vim.list_extend({ "git" }, args), opts):wait()
	assert(result.code == 0, result.stderr ~= "" and result.stderr or "git failed")
	return result.stdout
end

local function snapshot(repo, label)
	local index = git(repo, { "rev-parse", "--git-path", "index" })
	index = vim.fs.normalize(vim.fs.joinpath(repo, index))
	local temp = vim.fn.tempname() .. ".index"
	if vim.uv.fs_stat(index) then
		assert(vim.uv.fs_copyfile(index, temp))
	end
	local env = vim.tbl_extend("force", vim.fn.environ(), { GIT_INDEX_FILE = temp })
	local ok, result = pcall(function()
		-- Add everything, then drop the review's own state from the scratch index.
		-- The obvious `:(exclude).pi/agent-review` pathspec cannot be used: git
		-- fails the whole `add` when an exclude pathspec names an ignored path
		-- that exists on disk, and the spec tells every repo to ignore exactly
		-- that path. `--ignore-unmatch` keeps this quiet when it is not indexed.
		git(repo, { "add", "-A", "--", "." }, { env = env })
		git(repo, { "rm", "-r", "--cached", "--quiet", "--ignore-unmatch", "--", ".pi/agent-review" }, { env = env })
		local tree = git(repo, { "write-tree" }, { env = env })
		local commit = git(repo, { "commit-tree", tree, "-m", label }, { env = env })
		return { commit = commit, tree = tree }
	end)
	vim.fn.delete(temp)
	if not ok then
		error(result)
	end
	return result
end

local function read_json(path)
	local ok, lines = pcall(vim.fn.readfile, path)
	if not ok then
		return nil
	end
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
		if
			record
			and record.runId == id
			and valid_hash(record.base)
			and valid_hash(record["end"])
			and valid_hash(record.baseTree)
			and valid_hash(record.endTree)
		then
			table.insert(valid, { path = file, record = record })
		end
	end
	table.sort(valid, function(a, b)
		return a.record.startedAt < b.record.startedAt
	end)
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
		if rel then
			return rel
		end
		for _, marker in ipairs({ "/LOCAL/", "/WORKTREE/", "/local/" }) do
			local i = path:find(marker, 1, true)
			if i then
				return path:sub(i + #marker)
			end
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

local function in_panel(name)
	return name:match("^diffview://") ~= nil and name:match("DiffviewFilePanel$") ~= nil
end

-- The repo-relative path of the file the reviewer is pointing at, whether the
-- cursor is in a real buffer, a diffview diff pane, or the file panel.
--
-- In the panel, ask the panel: get_item_at_cursor() reads the cursor out of the
-- panel's own window id, so it holds however focus is reported. The two obvious
-- alternatives are both wrong. panel.cur_file is whichever file is *open* in the
-- diff, updated only by set_file, next_file, prev_file and the staging actions.
-- view:infer_cur_file() means well, but falls back to that same open file
-- whenever panel:is_focused() is false — observed live, and it silently names
-- the wrong path.
function M.cursor_file(repo)
	local name = vim.api.nvim_buf_get_name(0)
	if in_panel(name) then
		local ok, lib = pcall(require, "diffview.lib")
		local view = ok and lib.get_current_view() or nil
		local panel = view and view.panel
		local item = panel and panel.get_item_at_cursor and panel:get_item_at_cursor()
		-- Directory nodes carry `collapsed`; they name no single file.
		if item and type(item.collapsed) == "boolean" then
			return nil
		end
		return item and item.path or nil
	end
	local resolved, path = pcall(real_file, repo)
	return resolved and path or nil
end

-- The repo-relative paths the run touched, in record order.
function M.paths(record)
	local paths = {}
	for _, item in ipairs(record.files or {}) do
		if type(item.file) == "string" then
			table.insert(paths, item.file)
		end
	end
	return paths
end

-- Files in the run that cannot be rejected with reset_hunk, because the base
-- tree has no version of them to revert to.
function M.unrejectable(repo, record)
	local in_base = {}
	for _, path in
		ipairs(vim.split(git(repo, { "ls-tree", "-r", "--name-only", record.base }), "\n", { trimempty = true }))
	do
		in_base[path] = true
	end
	local added = {}
	for _, item in ipairs(record.files or {}) do
		if type(item.file) == "string" and not in_base[item.file] then
			table.insert(added, item.file)
		end
	end
	return added
end

function M.open()
	local ok, err = pcall(function()
		local repo = root()
		local entry = pending(repo)[1]
		if not entry then
			return vim.notify("No pending agent review", vim.log.levels.INFO)
		end
		local record = entry.record
		assert(valid_hash(record.base), "invalid base in pending record")
		M.current, M.notes = record, {}
		vlog("opened review %s with base %s", record.runId, record.base)
		-- Scope the view to the files this run touched. Unscoped, diffview shows
		-- every difference between the base and the working tree, so the panel
		-- lists files the agent never touched — and a reviewer can spend the whole
		-- review working on one of them, rejecting somebody else's work.
		local paths = M.paths(record)
		local args = { record.base }
		if #paths > 0 then
			table.insert(args, "--")
			vim.list_extend(args, paths)
		end
		require("diffview").open(args)
		require("gitsigns").change_base(record.base, true)
		vim.notify(
			("Reviewing %d file(s): %s. Accept: leave the hunk. Reject: :AgentReviewReject. Edit normally."):format(
				#paths,
				table.concat(paths, ", ")
			)
		)
		-- A file the run created has no version in the base, so gitsigns has no
		-- hunk to reset — and on an untracked file it does not attach at all
		-- (attach_to_untracked defaults to false), so reset_hunk returns silently.
		-- Deleting the file is the rejection: the base has no such path, so the
		-- final snapshot records its absence.
		local added = M.unrejectable(repo, record)
		if #added > 0 then
			vim.notify(
				("Agent review: %s %s new. Reject by deleting the file; :Gitsigns reset_hunk cannot revert a file with no base version."):format(
					table.concat(added, ", "),
					#added == 1 and "is" or "are"
				),
				vim.log.levels.WARN
			)
		end
	end)
	if not ok then
		vim.notify("AgentReview failed: " .. tostring(err), vim.log.levels.ERROR)
	end
end

-- Reject a whole file: restore the base version, or delete the file if the base
-- has none. This is deliberately independent of gitsigns, which attaches to
-- neither untracked files nor diffview's virtual buffers, and whose reset_hunk
-- returns silently when it cannot act. `path` defaults to the file under the
-- cursor, in a real buffer or in the diffview panel.
-- Has `path` changed since the run ended? Compare object ids rather than using
-- `git diff`, which ignores untracked files and would call a new file unchanged.
-- A missing file on either side counts as a difference.
local function changed_since(repo, tree, path)
	local recorded = vim.system({ "git", "rev-parse", "--verify", "--quiet", tree .. ":" .. path }, { cwd = repo, text = true }):wait()
	local on_disk = vim.uv.fs_stat(repo .. "/" .. path)
		and vim.system({ "git", "hash-object", "--", repo .. "/" .. path }, { cwd = repo, text = true }):wait()
	if recorded.code ~= 0 or not on_disk or on_disk.code ~= 0 then
		return not (recorded.code ~= 0 and not on_disk)
	end
	return vim.trim(recorded.stdout) ~= vim.trim(on_disk.stdout)
end

function M.reject(path, force)
	local ok, err = pcall(function()
		assert(M.current, "Open :AgentReview first")
		local repo, record = root(), M.current
		path = path and path ~= "" and path or M.cursor_file(repo)
		assert(path, "No file under the cursor. Pass a path: :AgentReviewReject <file>")
		local reviewed = false
		for _, item in ipairs(M.paths(record)) do
			if item == path then
				reviewed = true
			end
		end
		assert(reviewed, path .. " is not part of this review")
		-- Rejecting restores the whole file, so anything written into it since the
		-- run ended goes too — and that is usually the reviewer's own work, not
		-- the agent's. Refuse rather than discard it silently.
		assert(
			force or not changed_since(repo, record.endTree, path),
			path .. " changed after the run ended; rejecting would discard those edits. :AgentReviewReject! " .. path .. " to override"
		)
		local absolute = repo .. "/" .. path
		local in_base = vim.system({ "git", "cat-file", "-e", record.base .. ":" .. path }, { cwd = repo }):wait()
		if in_base.code == 0 then
			local content = git_raw(repo, { "show", record.base .. ":" .. path })
			vim.fn.mkdir(vim.fn.fnamemodify(absolute, ":h"), "p")
			vim.fn.writefile(vim.split(content, "\n", { plain = true }), absolute, "b")
			vim.notify("Rejected " .. path .. ": restored the base version.")
		else
			assert(vim.fn.delete(absolute) == 0, "could not delete " .. path)
			vim.notify("Rejected " .. path .. ": the run created it, so it was deleted.")
		end
		vim.cmd.checktime()
	end)
	if not ok then
		vim.notify("AgentReviewReject failed: " .. tostring(err), vim.log.levels.ERROR)
	end
end

function M.note()
	if not M.current then
		return vim.notify("Open :AgentReview first", vim.log.levels.WARN)
	end
	local repo = root()
	vim.ui.input({ prompt = "Agent review note: " }, function(note)
		local ok, err = pcall(function()
			if not note or note == "" then
				return
			end
			local name = vim.api.nvim_buf_get_name(0)
			local file, line
			if in_panel(name) then
				file = M.cursor_file(repo)
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
			vlog("note added to %s:%d", file, line)
		end)
		if not ok then
			vim.notify("AgentReviewNote failed: " .. tostring(err), vim.log.levels.ERROR)
		end
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
			if type(item.file) == "string" then
				table.insert(paths, item.file)
			end
		end
		local patch, changed = "", {}
		if #paths > 0 then
			patch = git_raw(repo, vim.list_extend({ "diff", record.endTree, final.tree, "--" }, vim.deepcopy(paths)))
			vlog("computed patch: %d bytes across %d paths", #patch, #paths)
			local names = git(
				repo,
				vim.list_extend({ "diff", "--name-only", record.endTree, final.tree, "--" }, vim.deepcopy(paths))
			)
			for _, file in ipairs(vim.split(names, "\n", { trimempty = true })) do
				changed[file] = true
			end
		end
		local files = {}
		for _, item in ipairs(record.files or {}) do
			table.insert(files, { file = item.file, status = changed[item.file] and "changed" or "accepted" })
		end
		atomic_json(review_dir(repo) .. "/decisions/" .. record.runId .. ".json", {
			runId = record.runId,
			endTree = record.endTree,
			finalTree = final.tree,
			files = files,
			notes = M.notes,
			patch = patch,
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
	if not ok then
		vim.notify("AgentReviewDone failed: " .. tostring(err), vim.log.levels.ERROR)
	end
end

-- Report the state the review actually depends on. Everything goes through one
-- vim.notify so it survives in :messages and in noice's log, unlike a bare
-- print() in the cmdline, which a redraw can wipe before you read it.
function M.debug()
	local lines = {}
	local function add(label, value)
		table.insert(lines, label .. ": " .. tostring(value))
	end
	add("buffer", vim.api.nvim_buf_get_name(0))
	local ok_gs, gs = pcall(require, "gitsigns")
	local hunks = ok_gs and gs.get_hunks() or nil
	add("gitsigns attached", hunks ~= nil)
	if hunks then
		add("hunks in this buffer", #hunks)
	end
	local ok_dv, lib = pcall(require, "diffview.lib")
	local view = ok_dv and lib.get_current_view() or nil
	if view and view.panel then
		local item = view.panel.get_item_at_cursor and view.panel:get_item_at_cursor()
		add("panel cursor", item and item.path or "none")
		add("open in diff", view.panel.cur_file and view.panel.cur_file.path or "none")
	end
	add("verbose", M.verbose)
	if M.current then
		add("review", M.current.runId)
		add("notes taken", #M.notes)
		local ok_root, repo = pcall(root)
		if ok_root then
			local added = M.unrejectable(repo, M.current)
			add("reject by deleting", #added > 0 and table.concat(added, ", ") or "none")
		end
	else
		add("review", "none open")
	end
	vim.notify(table.concat(lines, "\n"), vim.log.levels.INFO)
end

-- Compact one-line status for scripts and statuslines.
function M.status()
	if not M.current then
		return "no review open"
	end
	return ("review %s, %d note(s)"):format(M.current.runId:sub(1, 8), #M.notes)
end

-- Drop all notes without closing the review.
function M.clear_notes()
	if not M.current then
		return vim.notify("Open :AgentReview first", vim.log.levels.WARN)
	end
	M.notes = {}
	vim.notify("Agent review notes cleared")
end

vim.api.nvim_create_user_command("AgentReviewDebug", M.debug, {})
vim.api.nvim_create_user_command("AgentReviewStatus", function()
	vim.notify(M.status())
end, {})
vim.api.nvim_create_user_command("AgentReview", M.open, {})
vim.api.nvim_create_user_command("AgentReviewNote", M.note, {})
vim.api.nvim_create_user_command("AgentReviewReject", function(opts)
	M.reject(opts.args, opts.bang)
end, { nargs = "?", bang = true })
vim.api.nvim_create_user_command("AgentReviewDone", M.done, {})
vim.api.nvim_create_user_command("AgentReviewClearNotes", M.clear_notes, {})
vim.api.nvim_create_user_command("AgentReviewVerbose", function()
	M.verbose = not M.verbose
	vim.notify("Agent review verbose " .. (M.verbose and "on" or "off"))
end, {})
vim.keymap.set("n", "<leader>ar", M.open, { desc = "Agent: review run" })
vim.keymap.set("n", "<leader>an", M.note, { desc = "Agent: review note" })
vim.keymap.set("n", "<leader>aD", M.done, { desc = "Agent: review done" })
vim.keymap.set("n", "<leader>aR", function()
	M.reject()
end, { desc = "Agent: reject file under cursor" })
return M
