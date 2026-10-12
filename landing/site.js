(() => {
	const platform = document.getElementById('platform');
	const theme = document.getElementById('theme');
	const labels = {
		'linux-x64': 'Linux x64',
		'linux-arm64': 'Linux ARM64',
		'darwin-arm64': 'macOS Apple silicon',
		'darwin-x64': 'macOS Intel',
		'windows-x64': 'Windows x64',
	};
	const release = 'https://github.com/aylith-labs/tickets/releases/download/v0.1.4/';
	let epoch = 0;
	function selectPlatform() {
		if (!Object.hasOwn(labels, platform.value)) return;
		epoch++;
		const windows = platform.value === 'windows-x64';
		const suffix = platform.value + (windows ? '.exe' : '');
		document.getElementById('download-cli').href = `${release}tickets-${suffix}`;
		document.getElementById('download-cli').textContent = `Download for ${labels[platform.value]}`;
		document.getElementById('download-tui').href = `${release}tickets-tui-${suffix}`;
		document.getElementById('platform-help').textContent = windows
			? 'In PowerShell, open your project folder. The commands below run the downloaded binary directly.'
			: 'Open a terminal in your project folder. The commands below make the download executable and run it directly.';
		const downloaded = `tickets-${suffix}`;
		document.getElementById('commands').textContent = windows
			? `$tickets = Join-Path $HOME 'Downloads\\${downloaded}'\n& $tickets init --adapter folder\n& $tickets serve`
			: `chmod +x "$HOME/Downloads/${downloaded}"\n"$HOME/Downloads/${downloaded}" init --adapter folder\n"$HOME/Downloads/${downloaded}" serve`;
		document.getElementById('command-status').textContent = '';
	}
	platform.addEventListener('change', selectPlatform);
	selectPlatform();
	try {
		const saved = localStorage.getItem('tickets-theme');
		if (['system', 'light', 'dark'].includes(saved)) theme.value = saved;
	} catch {}
	theme.addEventListener('change', () => {
		if (!['system', 'light', 'dark'].includes(theme.value)) return;
		if (theme.value === 'system') delete document.documentElement.dataset.theme;
		else document.documentElement.dataset.theme = theme.value;
		try {
			localStorage.setItem('tickets-theme', theme.value);
		} catch {}
	});
	function copy(buttonId, textId, statusId) {
		const button = document.getElementById(buttonId),
			text = document.getElementById(textId),
			status = document.getElementById(statusId);
		button.addEventListener('click', async () => {
			const current = epoch;
			button.disabled = true;
			try {
				if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
				let timeout;
				try {
					await Promise.race([
						navigator.clipboard.writeText(text.textContent),
						new Promise((_, reject) => {
							timeout = setTimeout(() => reject(new Error('Clipboard timed out')), 2000);
						}),
					]);
				} finally {
					clearTimeout(timeout);
				}
				if (current === epoch) status.textContent = 'Copied. Paste it into your own terminal or agent when ready.';
			} catch {
				if (current === epoch) {
					const details = text.closest('details');
					if (details) details.open = true;
					text.focus();
					const selection = window.getSelection();
					const range = document.createRange();
					range.selectNodeContents(text);
					selection?.removeAllRanges();
					selection?.addRange(range);
					status.textContent = 'Copy is unavailable here. Select and copy the text above.';
				}
			} finally {
				button.disabled = false;
			}
		});
	}
	copy('copy-prompt', 'prompt', 'copy-status');
	copy('copy-commands', 'commands', 'command-status');
})();
