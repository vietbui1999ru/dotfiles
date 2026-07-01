vim.g.mapleader = " "
vim.g.maplocalleader = " "
vim.g.have_nerd_font = true

local _py = vim.fn.exepath("python3")
if _py ~= "" then
	vim.g.python3_host_prog = _py
end

local _node = vim.fn.exepath("node")
if _node ~= "" then
	vim.g.node_host_prog = _node
end

vim.g["coqtail#supported"] = 1
-- Prevent vim-kitty-navigator from claiming C-hjkl (use vim-tmux-navigator instead)
vim.g.kitty_navigator_no_mappings = 1

vim.opt.number = true
vim.opt.mouse = "a"
vim.opt.showmode = false
vim.schedule(function()
	vim.opt.clipboard = "unnamedplus"
end)
vim.opt.breakindent = true
vim.opt.undofile = true
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.signcolumn = "yes"
vim.opt.updatetime = 250
vim.opt.timeoutlen = 300
vim.opt.splitright = true
vim.opt.splitbelow = true
vim.opt.list = true
vim.opt.listchars = { tab = "» ", trail = "·", nbsp = "␣" }
vim.opt.inccommand = "split"
vim.opt.cursorline = true
vim.opt.scrolloff = 10
vim.opt.confirm = true
vim.opt.autoread = true

vim.keymap.set("n", "<Esc>", "<cmd>nohlsearch<CR>")
vim.keymap.set("i", "jk", "<ESC><CR>", { desc = "Go to normal mode" })
vim.keymap.set("i", "jkw", "<ESC>:w<CR>", { desc = "Go to normal mode save current file" })
vim.keymap.set("n", "<leader>q", vim.diagnostic.setloclist, { desc = "Open diagnostic [Q]uickfix list" })
vim.keymap.set("t", "<Esc><Esc>", "<C-\\><C-n>", { desc = "Exit terminal mode" })
vim.keymap.set("n", "<C-h>", "<C-w><C-h>", { desc = "Move focus to the left window" })
vim.keymap.set("n", "<C-l>", "<C-w><C-l>", { desc = "Move focus to the right window" })
vim.keymap.set("n", "<C-j>", "<C-w><C-j>", { desc = "Move focus to the lower window" })
vim.keymap.set("n", "<C-k>", "<C-w><C-k>", { desc = "Move focus to the upper window" })

vim.keymap.set("n", "<leader>ay", function()
	local path = vim.fn.expand("%:.")
	local line = vim.fn.line(".")
	local ref = path .. ":" .. line
	vim.fn.setreg("+", ref)
	vim.notify("Copied: " .. ref)
end, { desc = "Agent: yank file:line ref" })

vim.keymap.set("x", "<leader>ay", function()
	local path = vim.fn.expand("%:.")
	local l1 = vim.fn.line("v")
	local l2 = vim.fn.line(".")
	if l1 > l2 then
		l1, l2 = l2, l1
	end
	local lines = vim.api.nvim_buf_get_lines(0, l1 - 1, l2, false)
	local ft = vim.bo.filetype
	local ref = string.format("`%s:%d-%d`\n```%s\n%s\n```", path, l1, l2, ft, table.concat(lines, "\n"))
	vim.fn.setreg("+", ref)
	vim.notify(string.format("Copied: %s:%d-%d", path, l1, l2))
end, { desc = "Agent: yank file:line-range + code block" })

vim.api.nvim_create_autocmd("TextYankPost", {
	desc = "Highlight when yanking (copying) text",
	group = vim.api.nvim_create_augroup("kickstart-highlight-yank", { clear = true }),
	callback = function()
		vim.hl.on_yank()
	end,
})

vim.api.nvim_create_autocmd({ "FocusGained", "BufEnter" }, {
	desc = "Reload buffer if file changed externally (agent edits)",
	group = vim.api.nvim_create_augroup("agent-autoreload", { clear = true }),
	callback = function()
		if vim.fn.getcmdwintype() == "" then
			vim.cmd("checktime")
		end
	end,
})

local gh = function(x)
	return "https://github.com/" .. x
end

vim.api.nvim_create_autocmd("PackChanged", {
	group = vim.api.nvim_create_augroup("pack-build-hooks", { clear = true }),
	callback = function(ev)
		local name = ev.data.spec.name
		local kind = ev.data.kind
		local path = ev.data.path
		if kind ~= "install" and kind ~= "update" then
			return
		end
		if name == "telescope-fzf-native.nvim" then
			vim.system({ "make" }, { cwd = path })
		elseif name == "LuaSnip" then
			vim.system({ "make", "install_jsregexp" }, { cwd = path })
		elseif name == "vim-kitty-navigator" then
			vim.system({ "sh", "-c", "cp ./*.py ~/.config/kitty/" }, { cwd = path })
		elseif name == "nvim-treesitter" then
			vim.schedule(function()
				vim.cmd("TSUpdate")
			end)
		end
	end,
})

vim.pack.add({
	gh("nvim-lua/plenary.nvim"),
	gh("MunifTanjim/nui.nvim"),
	gh("nvim-tree/nvim-web-devicons"),
	gh("stevearc/dressing.nvim"),
	{ src = gh("catppuccin/nvim"), name = "catppuccin" },
	gh("tpope/vim-sleuth"),
	gh("lewis6991/gitsigns.nvim"),
	gh("wakatime/vim-wakatime"),
	gh("numToStr/Comment.nvim"),
	{ src = gh("mason-org/mason.nvim"), name = "mason.nvim" },
	{ src = gh("mason-org/mason-lspconfig.nvim"), name = "mason-lspconfig.nvim" },
	gh("WhoIsSethDaniel/mason-tool-installer.nvim"),
	gh("neovim/nvim-lspconfig"),
	gh("j-hui/fidget.nvim"),
	gh("folke/lazydev.nvim"),
	{ src = gh("saghen/blink.cmp"), version = vim.version.range("1") },
	{ src = gh("L3MON4D3/LuaSnip"), name = "LuaSnip", version = vim.version.range("2") },
	gh("stevearc/conform.nvim"),
	{ src = gh("nvim-treesitter/nvim-treesitter"), version = "main" },
	gh("nvim-telescope/telescope.nvim"),
	{ src = gh("nvim-telescope/telescope-fzf-native.nvim"), name = "telescope-fzf-native.nvim" },
	gh("nvim-telescope/telescope-ui-select.nvim"),
	gh("folke/noice.nvim"),
	gh("folke/snacks.nvim"),
	gh("nvim-lualine/lualine.nvim"),
	gh("echasnovski/mini.nvim"),
	{ src = gh("NvChad/nvim-colorizer.lua"), name = "nvim-colorizer.lua" },
	gh("folke/which-key.nvim"),
	gh("folke/todo-comments.nvim"),
	gh("OXY2DEV/markview.nvim"),
	gh("saxon1964/neovim-tips"),
	gh("sindrets/diffview.nvim"),
	gh("kdheepak/lazygit.nvim"),
	gh("NeogitOrg/neogit"),
	gh("stevearc/oil.nvim"),
	gh("christoomey/vim-tmux-navigator"),
	gh("mrjones2014/smart-splits.nvim"),
	gh("knubie/vim-kitty-navigator"),
	gh("aserowy/tmux.nvim"),
	gh("mfussenegger/nvim-dap"),
	gh("rcarriga/nvim-dap-ui"),
	gh("theHamsta/nvim-dap-virtual-text"),
	gh("nvim-neotest/nvim-nio"),
	gh("jay-babu/mason-nvim-dap.nvim"),
	gh("3rd/image.nvim"),
	gh("3rd/diagram.nvim"),
	gh("HakonHarnes/img-clip.nvim"),
	gh("zbirenbaum/copilot.lua"),
	gh("ravitemer/mcphub.nvim"),
	gh("epwalsh/obsidian.nvim"),
	{ src = gh("kawre/leetcode.nvim"), name = "leetcode.nvim" },
	gh("Julian/lean.nvim"),
	gh("pwntester/octo.nvim"),
	-- gh("folke/sidekick.nvim"),
})

if vim.g.vscode then
	vim.cmd.packadd("Comment.nvim")
	require("Comment").setup({})
	vim.cmd.packadd("mini.nvim")
	require("mini.ai").setup({ n_lines = 500 })
	require("mini.surround").setup()
	return
end

vim.cmd.packadd("plenary.nvim")
vim.cmd.packadd("nui.nvim")
vim.cmd.packadd("nvim-web-devicons")
vim.cmd.packadd("dressing.nvim")

vim.cmd.packadd("catppuccin")
require("catppuccin").setup({
	flavour = "macchiato",
	background = { light = "latte", dark = "mocha" },
	transparent_background = true,
	float = { transparent = true, solid = true },
	show_end_of_buffer = false,
	term_colors = true,
	dim_inactive = { enabled = false, shade = "dark", percentage = 0.15 },
	no_italic = false,
	no_bold = false,
	no_underline = false,
	styles = {
		comments = { "italic" },
		conditionals = { "italic" },
		loops = {},
		functions = {},
		keywords = {},
		strings = {},
		variables = {},
		numbers = {},
		booleans = {},
		properties = {},
		types = {},
		operators = {},
	},
	color_overrides = {},
	custom_highlights = {},
	default_integrations = true,
	auto_integrations = false,
	integrations = {
		cmp = true,
		gitsigns = true,
		nvimtree = true,
		treesitter = true,
		notify = false,
		mini = { enabled = true, indentscope_color = "" },
	},
})
vim.cmd.colorscheme("catppuccin")

vim.cmd.packadd("snacks.nvim")
require("custom.plugins.snacks")

vim.cmd.packadd("noice.nvim")
require("custom.plugins.noice")

vim.cmd.packadd("vim-sleuth")

vim.cmd.packadd("gitsigns.nvim")
require("gitsigns").setup({
	signs = {
		add = { text = "+" },
		change = { text = "~" },
		delete = { text = "_" },
		topdelete = { text = "‾" },
		changedelete = { text = "~" },
	},
})

vim.cmd.packadd("vim-wakatime")

vim.cmd.packadd("smart-splits.nvim")
require("custom.plugins.smart-splits")

vim.cmd.packadd("vim-tmux-navigator")
require("custom.plugins.vim-tmux-navigator")

vim.cmd.packadd("tmux.nvim")
require("custom.plugins.tmux")

-- Only load kitty navigator when NOT in tmux (kitty-native pane layout only)
if not os.getenv("TMUX") then
	vim.cmd.packadd("vim-kitty-navigator")
end

vim.cmd.packadd("oil.nvim")
require("custom.plugins.oil")

vim.cmd.packadd("mini.nvim")
require("custom.plugins.mini")

vim.cmd.packadd("Comment.nvim")
require("Comment").setup({})

vim.cmd.packadd("nvim-colorizer.lua")
require("custom.plugins.colorizer")

vim.cmd.packadd("image.nvim")
require("custom.plugins.image")

vim.cmd.packadd("diagram.nvim")
require("custom.plugins.diagram")

vim.cmd.packadd("img-clip.nvim")
require("custom.plugins.img-clip")

vim.cmd.packadd("diffview.nvim")
vim.keymap.set("n", "<leader>gd", "<cmd>DiffviewOpen<cr>", { desc = "Diffview: open repo diff" })
vim.keymap.set("n", "<leader>gf", "<cmd>DiffviewFileHistory %<cr>", { desc = "Diffview: file history" })
vim.keymap.set("n", "<leader>gq", "<cmd>DiffviewClose<cr>", { desc = "Diffview: close" })

vim.cmd.packadd("lazygit.nvim")
require("custom.plugins.lazygit")

vim.cmd.packadd("neogit")
require("custom.plugins.neogit")

vim.cmd.packadd("octo.nvim")
require("custom.plugins.octo")

vim.cmd.packadd("mcphub.nvim")
require("custom.plugins.mcp-hub")

vim.cmd.packadd("nvim-dap")
vim.cmd.packadd("nvim-dap-ui")
vim.cmd.packadd("nvim-dap-virtual-text")
vim.cmd.packadd("nvim-nio")
vim.cmd.packadd("mason-nvim-dap.nvim")
require("custom.plugins.dap")

vim.cmd.packadd("leetcode.nvim")
require("custom.plugins.leetcode")

vim.cmd.packadd("lean.nvim")
require("custom.plugins.lean")

vim.api.nvim_create_autocmd("VimEnter", {
	once = true,
	group = vim.api.nvim_create_augroup("pack-vimenter", { clear = true }),
	callback = function()
		vim.cmd.packadd("telescope.nvim")
		vim.cmd.packadd("telescope-fzf-native.nvim")
		vim.cmd.packadd("telescope-ui-select.nvim")

		require("telescope").setup({
			extensions = {
				["ui-select"] = {
					require("telescope.themes").get_dropdown(),
				},
			},
		})
		pcall(require("telescope").load_extension, "fzf")
		pcall(require("telescope").load_extension, "ui-select")

		local builtin = require("telescope.builtin")
		vim.keymap.set("n", "<leader>sh", builtin.help_tags, { desc = "[S]earch [H]elp" })
		vim.keymap.set("n", "<leader>sk", builtin.keymaps, { desc = "[S]earch [K]eymaps" })
		vim.keymap.set("n", "<leader>sf", builtin.find_files, { desc = "[S]earch [F]iles" })
		vim.keymap.set("n", "<leader>ss", builtin.builtin, { desc = "[S]earch [S]elect Telescope" })
		vim.keymap.set("n", "<leader>sw", builtin.grep_string, { desc = "[S]earch current [W]ord" })
		vim.keymap.set("n", "<leader>sg", builtin.live_grep, { desc = "[S]earch by [G]rep" })
		vim.keymap.set("n", "<leader>sd", builtin.diagnostics, { desc = "[S]earch [D]iagnostics" })
		vim.keymap.set("n", "<leader>sr", builtin.resume, { desc = "[S]earch [R]esume" })
		vim.keymap.set("n", "<leader>s.", builtin.oldfiles, { desc = '[S]earch Recent Files ("." for repeat)' })
		vim.keymap.set("n", "<leader><leader>", builtin.buffers, { desc = "[ ] Find existing buffers" })
		vim.keymap.set("n", "<leader>/", function()
			builtin.current_buffer_fuzzy_find(require("telescope.themes").get_dropdown({
				winblend = 10,
				previewer = false,
			}))
		end, { desc = "[/] Fuzzily search in current buffer" })
		vim.keymap.set("n", "<leader>s/", function()
			builtin.live_grep({ grep_open_files = true, prompt_title = "Live Grep in Open Files" })
		end, { desc = "[S]earch [/] in Open Files" })
		vim.keymap.set("n", "<leader>sn", function()
			builtin.find_files({ cwd = vim.fn.stdpath("config") })
		end, { desc = "[S]earch [N]eovim files" })

		vim.cmd.packadd("lualine.nvim")

		local _cmd = { ts = 0, root = nil, result = "" }
		vim.api.nvim_create_autocmd("DirChanged", {
			callback = function()
				_cmd.root = nil
			end,
		})
		local function commandr_status()
			if os.time() - _cmd.ts < 2 then
				return _cmd.result
			end
			_cmd.ts = os.time()
			if not _cmd.root then
				local r = vim.fn.system("git rev-parse --show-toplevel 2>/dev/null"):gsub("\n", "")
				if vim.v.shell_error == 0 and r ~= "" then
					_cmd.root = r
				end
			end
			if not _cmd.root then
				_cmd.result = ""
				return ""
			end
			local files = vim.fn.glob(_cmd.root .. "/.agents/claimed/*.md", false, true)
			local tasks = {}
			for _, f in ipairs(files) do
				local name = vim.fn.fnamemodify(f, ":t:r")
				local task_id = name:match("^[^_]+_[^_]+_(.+)$")
				if task_id then
					tasks[#tasks + 1] = task_id
				end
			end
			_cmd.result = #tasks == 1 and ("[" .. tasks[1] .. "]") or #tasks > 1 and ("[" .. #tasks .. " tasks]") or ""
			return _cmd.result
		end

		require("lualine").setup({
			sections = {
				lualine_a = { "mode" },
				lualine_b = { "branch", "diff", "diagnostics", { commandr_status, color = { fg = "#cba6f7" } } },
				lualine_c = {
					"filename",
					{
						function()
							local ok, dv = pcall(require, "diffviewer")
							return ok and dv.statusline() or ""
						end,
						color = { fg = "#f38ba8" },
					},
				},
				lualine_x = {
					-- {
					-- 	function()
					-- 		local ok, vt = pcall(require, "codeium.virtual_text")
					-- 		return ok and (" " .. vt.status_string()) or " "
					-- 	end,
					-- 	color = { fg = "#89dceb" },
					-- },
					{
						function()
							local clients = vim.lsp.get_clients({ name = "copilot" })
							return #clients > 0 and " " or " "
						end,
						color = { fg = "#a6e3a1" },
					},
					{
						function()
							return string.format("%2d:%-2d", vim.fn.line("."), vim.fn.col("."))
						end,
					},
					"encoding",
					"fileformat",
					"filetype",
				},
				lualine_y = { "progress" },
				lualine_z = { "location" },
			},
		})

		vim.cmd.packadd("which-key.nvim")
		require("which-key").setup({
			delay = 0,
			icons = {
				mappings = vim.g.have_nerd_font,
				keys = vim.g.have_nerd_font and {} or {
					Up = "<Up> ",
					Down = "<Down> ",
					Left = "<Left> ",
					Right = "<Right> ",
					C = "<C-…> ",
					M = "<M-…> ",
					D = "<D-…> ",
					S = "<S-…> ",
					CR = "<CR> ",
					Esc = "<Esc> ",
					ScrollWheelDown = "<ScrollWheelDown> ",
					ScrollWheelUp = "<ScrollWheelUp> ",
					NL = "<NL> ",
					BS = "<BS> ",
					Space = "<Space> ",
					Tab = "<Tab> ",
					F1 = "<F1>",
					F2 = "<F2>",
					F3 = "<F3>",
					F4 = "<F4>",
					F5 = "<F5>",
					F6 = "<F6>",
					F7 = "<F7>",
					F8 = "<F8>",
					F9 = "<F9>",
					F10 = "<F10>",
					F11 = "<F11>",
					F12 = "<F12>",
				},
			},
			spec = {
				{ "<leader>s", group = "[S]earch" },
				{ "<leader>t", group = "[T]oggle" },
				{ "<leader>h", group = "Git [H]unk", mode = { "n", "v" } },
			},
		})

		vim.cmd.packadd("todo-comments.nvim")
		require("todo-comments").setup({ signs = false })

		-- vim.cmd.packadd("sidekick.nvim")
		-- require("custom.plugins.sidekick")

		vim.cmd.packadd("copilot.lua")
		require("custom.plugins.copilot")

		vim.cmd.packadd("markview.nvim")

		vim.cmd.packadd("neovim-tips")
		require("custom.plugins.tips")

		vim.cmd.packadd("octo.nvim")
		require("custom.plugins.octo")

		require("which-key").add({
			{ "<leader>o", group = "[O]cto" },
		})
	end,
})

vim.api.nvim_create_autocmd("BufReadPre", {
	once = true,
	group = vim.api.nvim_create_augroup("pack-lsp", { clear = true }),
	callback = function()
		vim.cmd.packadd("lazydev.nvim")
		require("lazydev").setup({
			library = {
				{ path = "${3rd}/luv/library", words = { "vim%.uv" } },
			},
		})

		vim.cmd.packadd("fidget.nvim")
		require("fidget").setup({})

		vim.cmd.packadd("mason.nvim")
		-- Ensure language toolchains are visible to Mason
		local mason_path = vim.env.PATH or ""
		for _, p in ipairs({ "/usr/local/go/bin", vim.env.HOME .. "/go/bin", vim.env.HOME .. "/.local/bin" }) do
			if not mason_path:find(p, 1, true) then
				vim.env.PATH = p .. ":" .. vim.env.PATH
			end
		end
		require("mason").setup({})

		vim.cmd.packadd("mason-lspconfig.nvim")
		vim.cmd.packadd("mason-tool-installer.nvim")
		vim.cmd.packadd("nvim-lspconfig")

		vim.cmd.packadd("LuaSnip")
		require("luasnip").setup({})

		vim.cmd.packadd("blink.cmp")
		require("blink.cmp").setup({
			enabled = function()
				local bufname = vim.api.nvim_buf_get_name(0)
				return not bufname:match("^%w+://")
			end,
			appearance = { nerd_font_variant = "mono" },
			completion = {
				menu = { auto_show = true },
				ghost_text = { show_with_menu = false, enabled = true },
				documentation = { auto_show = false, auto_show_delay_ms = 500 },
			},
			snippets = { preset = "luasnip" },
			fuzzy = { implementation = "lua" },
			signature = { enabled = true },
			keymap = {
				preset = "default",
				["<C-y>"] = { "hide" },
				["<C-e>"] = { "select_and_accept" },
				["<Tab>"] = { "snippet_forward", "fallback" },
			},
			sources = {
				default = { "lazydev", "lsp", "path", "snippets", "buffer" },
				providers = {
					-- codeium = { name = "Codeium", module = "codeium.blink", async = true },
					lazydev = { module = "lazydev.integrations.blink", score_offset = 100 },
				},
			},
		})

		vim.cmd.packadd("conform.nvim")
		require("conform").setup({
			notify_on_error = false,
			format_on_save = function(bufnr)
				local disable_filetypes = { c = true, cpp = true }
				if disable_filetypes[vim.bo[bufnr].filetype] then
					return nil
				else
					return { timeout_ms = 500, lsp_format = "fallback" }
				end
			end,
			formatters_by_ft = {
				lua = { "stylua" },
				javascript = { "prettierd", "prettier", stop_after_first = true },
			},
		})
		vim.keymap.set("", "<leader>f", function()
			require("conform").format({ async = true, lsp_format = "fallback" })
		end, { desc = "[F]ormat buffer" })

		vim.cmd.packadd("nvim-treesitter")
		require("nvim-treesitter").setup({
			ensure_installed = {
				"bash",
				"c",
				"diff",
				"html",
				"lua",
				"luadoc",
				"markdown",
				"markdown_inline",
				"query",
				"vim",
				"vimdoc",
			},
			auto_install = true,
		})

		vim.api.nvim_create_autocmd("LspAttach", {
			group = vim.api.nvim_create_augroup("kickstart-lsp-attach", { clear = true }),
			callback = function(event)
				local map = function(keys, func, desc, mode)
					mode = mode or "n"
					vim.keymap.set(mode, keys, func, { buffer = event.buf, desc = "LSP: " .. desc })
				end

				map("grn", vim.lsp.buf.rename, "[R]e[n]ame")
				map("K", vim.lsp.buf.hover, "Hover Do[K]umentation")
				map("gra", vim.lsp.buf.code_action, "[G]oto Code [A]ction", { "n", "x" })
				map("grr", require("telescope.builtin").lsp_references, "[G]oto [R]eferences")
				map("gri", require("telescope.builtin").lsp_implementations, "[G]oto [I]mplementation")
				map("grd", require("telescope.builtin").lsp_definitions, "[G]oto [D]efinition")
				map("grD", vim.lsp.buf.declaration, "[G]oto [D]eclaration")
				map("gO", require("telescope.builtin").lsp_document_symbols, "Open Document Symbols")
				map("gW", require("telescope.builtin").lsp_dynamic_workspace_symbols, "Open Workspace Symbols")
				map("grt", require("telescope.builtin").lsp_type_definitions, "[G]oto [T]ype Definition")

				local function client_supports_method(client, method, bufnr)
					if vim.fn.has("nvim-0.11") == 1 then
						return client:supports_method(method, bufnr)
					else
						return client.supports_method(method, { bufnr = bufnr })
					end
				end

				local client = vim.lsp.get_client_by_id(event.data.client_id)
				if
					client
					and client_supports_method(
						client,
						vim.lsp.protocol.Methods.textDocument_documentHighlight,
						event.buf
					)
				then
					local highlight_augroup = vim.api.nvim_create_augroup("kickstart-lsp-highlight", { clear = false })
					vim.api.nvim_create_autocmd({ "CursorHold", "CursorHoldI" }, {
						buffer = event.buf,
						group = highlight_augroup,
						callback = vim.lsp.buf.document_highlight,
					})
					vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
						buffer = event.buf,
						group = highlight_augroup,
						callback = vim.lsp.buf.clear_references,
					})
					vim.api.nvim_create_autocmd("LspDetach", {
						group = vim.api.nvim_create_augroup("kickstart-lsp-detach", { clear = true }),
						callback = function(event2)
							vim.lsp.buf.clear_references()
							vim.api.nvim_clear_autocmds({
								group = "kickstart-lsp-highlight",
								buffer = event2.buf,
							})
						end,
					})
				end

				if
					client
					and client_supports_method(client, vim.lsp.protocol.Methods.textDocument_inlayHint, event.buf)
				then
					map("<leader>th", function()
						vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled({ bufnr = event.buf }))
					end, "[T]oggle Inlay [H]ints")
				end
			end,
		})

		vim.diagnostic.config({
			severity_sort = true,
			float = { border = "rounded", source = "if_many" },
			underline = { severity = vim.diagnostic.severity.ERROR },
			signs = vim.g.have_nerd_font and {
				text = {
					[vim.diagnostic.severity.ERROR] = "󰅚 ",
					[vim.diagnostic.severity.WARN] = "󰀪 ",
					[vim.diagnostic.severity.INFO] = "󰋽 ",
					[vim.diagnostic.severity.HINT] = "󰌶 ",
				},
			} or {},
			virtual_text = {
				source = "if_many",
				spacing = 2,
				format = function(diagnostic)
					local diagnostic_message = {
						[vim.diagnostic.severity.ERROR] = diagnostic.message,
						[vim.diagnostic.severity.WARN] = diagnostic.message,
						[vim.diagnostic.severity.INFO] = diagnostic.message,
						[vim.diagnostic.severity.HINT] = diagnostic.message,
					}
					return diagnostic_message[diagnostic.severity]
				end,
			},
		})

		local capabilities = require("blink.cmp").get_lsp_capabilities()
		local servers = {
			lua_ls = {
				settings = {
					Lua = {
						completion = { callSnippet = "Replace" },
					},
				},
			},
			ts_ls = {},
			pyright = {},
			rust_analyzer = {},
			bashls = {},
			gopls = {},
		}

		local ensure_installed = vim.tbl_keys(servers or {})
		vim.list_extend(ensure_installed, { "stylua", "prettierd", "eslint_d" })
		require("mason-tool-installer").setup({ ensure_installed = ensure_installed })

		require("mason-lspconfig").setup({
			ensure_installed = {},
			automatic_installation = true,
			handlers = {
				function(server_name)
					local server = servers[server_name] or {}
					server.capabilities = vim.tbl_deep_extend("force", {}, capabilities, server.capabilities or {})
					-- workaround: nvim 0.12.x incremental sync assertion bug (sync.lua:136)
					server.flags = vim.tbl_deep_extend("force", { allow_incremental_sync = false }, server.flags or {})
					require("lspconfig")[server_name].setup(server)
				end,
			},
		})

		require("custom.plugins.lsp-ocaml")
	end,
})

vim.api.nvim_create_autocmd("FileType", {
	pattern = "markdown",
	once = true,
	group = vim.api.nvim_create_augroup("pack-obsidian", { clear = true }),
	callback = function()
		vim.cmd.packadd("obsidian.nvim")
		require("custom.plugins.obsidian")
	end,
})
