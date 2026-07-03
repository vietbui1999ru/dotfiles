--- Config gate for the local Commandr/Pi/Neovim agent workflow.
---
--- Loads ~/.config/agent-workflow/config.json plus optional repo overrides:
---   .agent-workflow.json
---   .agent-workflow.local.json

local M = {}

local DEFAULTS = {
	commandr = true,
	preCommitGate = true,
	diffviewer = true,
	neovimCockpit = true,
	piCockpit = true,
	opencodeAdapters = true,
	claudeHooks = false,
	autoOpenNeovimBoard = false,
}

local _cache_key = nil
local _cache_config = nil

local function read_json(path)
	if vim.fn.filereadable(path) == 0 then
		return {}
	end
	local ok, lines = pcall(vim.fn.readfile, path)
	if not ok or not lines then
		vim.notify("agent-workflow: cannot read " .. path, vim.log.levels.WARN)
		return {}
	end
	local parsed, data = pcall(vim.json.decode, table.concat(lines, "\n"))
	if parsed and type(data) == "table" then
		return data
	end
	vim.notify("agent-workflow: invalid JSON in " .. path, vim.log.levels.WARN)
	return {}
end

local function merge(dst, src)
	for k, v in pairs(src or {}) do
		dst[k] = v
	end
	return dst
end

function M.repo_root()
	local out = vim.fn.system({ "git", "rev-parse", "--show-toplevel" })
	if vim.v.shell_error == 0 and out and out ~= "" then
		return vim.fn.trim(out)
	end
	return vim.fn.getcwd()
end

function M.main_root()
	local common = vim.fn.system({ "git", "rev-parse", "--git-common-dir" })
	if vim.v.shell_error ~= 0 or not common or common == "" then
		return M.repo_root()
	end
	common = vim.fn.trim(common)
	if not vim.startswith(common, "/") then
		common = vim.fn.getcwd() .. "/" .. common
	end
	return vim.fn.fnamemodify(common, ":p:h")
end

function M.bus_dir()
	return M.main_root() .. "/.agents"
end

function M.has_bus()
	local bus = M.bus_dir()
	return vim.fn.isdirectory(bus .. "/inbox") ~= 0
		and vim.fn.isdirectory(bus .. "/claimed") ~= 0
		and vim.fn.isdirectory(bus .. "/done") ~= 0
		and vim.fn.filereadable(bus .. "/events.jsonl") ~= 0
end

function M.config()
	local root = M.main_root()
	local key = vim.fn.getcwd() .. "|" .. root
	if _cache_key == key and _cache_config then
		return _cache_config
	end

	local cfg = vim.deepcopy(DEFAULTS)
	merge(cfg, read_json(vim.fn.expand("~/.config/agent-workflow/config.json")))
	merge(cfg, read_json(root .. "/.agent-workflow.json"))
	merge(cfg, read_json(root .. "/.agent-workflow.local.json"))

	_cache_key = key
	_cache_config = cfg
	return cfg
end

function M.enabled(key)
	return M.config()[key] ~= false
end

function M.commandr_ready()
	return M.enabled("commandr") and M.has_bus()
end

return M
