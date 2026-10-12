import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ids = [
	'platform',
	'theme',
	'download-cli',
	'download-tui',
	'platform-help',
	'command-status',
	'copy-prompt',
	'prompt',
	'copy-status',
	'copy-commands',
	'commands',
];
const nodes = Object.fromEntries(
	ids.map((id) => [
		id,
		{
			value: id === 'platform' ? 'linux-x64' : 'system',
			textContent: id,
			events: {},
			addEventListener(t, f) {
				this.events[t] = f;
			},
			closest() {
				return null;
			},
			focus() {
				this.focused = true;
			},
		},
	]),
);
const dataset = {};
let copied,
	fail = false,
	hang = false;
const storage = new Map();
vm.runInNewContext(readFileSync(new URL('./site.js', import.meta.url), 'utf8'), {
	document: {
		getElementById: (id) => nodes[id],
		documentElement: { dataset },
		createRange: () => ({ selectNodeContents() {} }),
	},
	localStorage: { getItem: (k) => storage.get(k), setItem: (k, v) => storage.set(k, v) },
	navigator: {
		clipboard: {
			writeText: async (t) => {
				if (fail) throw Error();
				if (hang) return new Promise(() => {});
				copied = t;
			},
		},
	},
	setTimeout,
	clearTimeout,
	window: { getSelection: () => ({ removeAllRanges() {}, addRange() {} }) },
});
for (const p of ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64', 'windows-x64']) {
	nodes.platform.value = p;
	nodes.platform.events.change();
	assert.equal(
		nodes['download-cli'].href,
		`https://github.com/aylith-labs/tickets/releases/download/v0.1.3/tickets-${p}${p.startsWith('windows') ? '.exe' : ''}`,
	);
	assert.match(nodes['download-tui'].href, /tickets-tui-/);
}
nodes.theme.value = 'dark';
nodes.theme.events.change();
assert.equal(dataset.theme, 'dark');
assert.equal(storage.get('tickets-theme'), 'dark');
nodes.theme.value = 'system';
nodes.theme.events.change();
assert.equal(dataset.theme, undefined);
await nodes['copy-prompt'].events.click();
assert.equal(copied, 'prompt');
assert.match(nodes.commands.textContent, /Join-Path/);
assert.match(nodes.commands.textContent, /tickets-windows-x64.exe/);
assert.match(nodes['copy-status'].textContent, /Copied/);
assert.equal(nodes['copy-prompt'].disabled, false);
fail = true;
await nodes['copy-commands'].events.click();
assert.equal(nodes.commands.focused, true);
assert.match(nodes['command-status'].textContent, /unavailable/);
assert.equal(nodes['copy-commands'].disabled, false);
fail = false;
hang = true;
const started = Date.now();
await nodes['copy-commands'].events.click();
assert.ok(Date.now() - started < 3000);
assert.equal(nodes['copy-commands'].disabled, false);
assert.match(nodes['command-status'].textContent, /unavailable/);
console.log('PASS: five platform downloads, theme persistence, clipboard success and failure/manual focus');
