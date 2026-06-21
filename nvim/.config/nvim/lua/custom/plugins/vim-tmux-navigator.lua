if vim.g.vscode then
	return
end
-- keymaps handled by vimscript plugin (plugin/tmux_navigator.vim)
-- <cmd><C-U> in lua does not expand <C-U> correctly; vimscript :<C-U> does
