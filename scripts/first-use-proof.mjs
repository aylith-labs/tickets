/** Bounded published v0.1.3 proof. Never builds or modifies Tickets sources.
 * node scripts/first-use-proof.mjs prepare --bun <bun.exe> --git <git.exe>
 * node scripts/first-use-proof.mjs browser --root <retained-temp-root> --playwright <module-dir>
 * Inspect the prepare receipt and serialize browser work before the second command.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const [phase, ...args] = process.argv.slice(2);
const option = (name) => args[args.indexOf(`--${name}`) + 1];
const required = (name) => {
  assert(args.includes(`--${name}`) && option(name), `Missing --${name}`);
  return resolve(option(name));
};
const sha = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const json = async (file, value) => writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
const now = () => new Date().toISOString();
const root = phase === 'prepare' ? await mkdtemp(join(tmpdir(), 'tickets-first-use-')) : required('root');
assert(root.startsWith(`${resolve(tmpdir())}${sep}`), 'Evidence must be inside the temporary directory');
console.log(JSON.stringify({ phase, root, at: now() }));
const receiptFile = join(root, `${phase}-receipt.json`);
const receipt = { phase, root, startedAt: now(), commands: [], checks: [], jobs: [], findings: [] };
const save = () => json(receiptFile, receipt);
const check = async (name, details) => {
  receipt.checks.push({ name, at: now(), details });
  await save();
  console.log(JSON.stringify({ check: name, details }));
};

function isolatedEnv(profile, gitPath) {
  const env = {};
  for (const key of ['SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'NUMBER_OF_PROCESSORS']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  return {
    ...env,
    PATH: [dirname(gitPath), join(systemRoot, 'System32'), systemRoot].join(';'),
    HOME: profile, USERPROFILE: profile, HOMEDRIVE: profile.slice(0, 2), HOMEPATH: profile.slice(2),
    APPDATA: join(profile, 'AppData', 'Roaming'), LOCALAPPDATA: join(profile, 'AppData', 'Local'),
    XDG_CONFIG_HOME: join(profile, '.config'), XDG_CACHE_HOME: join(profile, '.cache'),
    XDG_DATA_HOME: join(profile, '.local', 'share'), TEMP: join(profile, 'tmp'), TMP: join(profile, 'tmp'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(profile, '.gitconfig'),
    GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never',
    NPM_CONFIG_USERCONFIG: join(profile, '.npmrc'), NPM_CONFIG_GLOBALCONFIG: join(profile, 'npm-globalrc'),
    NPM_CONFIG_CACHE: join(profile, '.npm-cache'),
  };
}

async function run(executable, argv, cwd, env, label) {
  const command = { label, executable, argv, cwd, startedAt: now() };
  const child = spawn(executable, argv, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  command.pid = child.pid;
  let stdout = '', stderr = '';
  child.stdout.on('data', (bytes) => { stdout += bytes; });
  child.stderr.on('data', (bytes) => { stderr += bytes; });
  const timer = setTimeout(() => child.kill(), 30000);
  try {
    const [code, signal] = await once(child, 'close');
    Object.assign(command, { code, signal, stdout, stderr, endedAt: now() });
  } finally { clearTimeout(timer); }
  receipt.commands.push(command);
  await save();
  return command;
}

async function getJson(url, name) {
  const response = await fetch(url, { headers: { 'User-Agent': 'aylith-tickets-first-use-proof' } });
  assert.equal(response.status, 200, url);
  const body = await response.json();
  await json(join(root, name), { url, finalUrl: response.url, status: response.status, receivedAt: now(), body });
  return body;
}

async function download(url, file) {
  const response = await fetch(url);
  assert.equal(response.status, 200, url);
  assert(['github.com', 'release-assets.githubusercontent.com', 'registry.npmjs.org'].includes(new URL(response.url).hostname));
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(file, bytes);
  return bytes;
}

const live = new Set();
let browser;
async function stop(job) {
  if (job.child.exitCode === null && job.child.signalCode === null) {
    const closed = once(job.child, 'close');
    job.child.kill();
    await closed;
  }
  Object.assign(job.record, { exitedAt: now(), exitCode: job.child.exitCode, signal: job.child.signalCode });
  await writeFile(join(root, `${job.record.label}.stdout.log`), job.stdout);
  await writeFile(join(root, `${job.record.label}.stderr.log`), job.stderr);
  live.delete(job);
  await save();
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

async function start(state, port, label) {
  const child = spawn(state.binary, ['serve', '--port', String(port)], {
    cwd: state.folderRepo, env: state.folderEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const job = { child, stdout: '', stderr: '', record: { label, pid: child.pid, port, startedAt: now(), executable: state.binary } };
  live.add(job);
  receipt.jobs.push(job.record);
  child.stdout.on('data', (bytes) => { job.stdout += bytes; });
  child.stderr.on('data', (bytes) => { job.stderr += bytes; });
  const base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(child.exitCode, null, `Daemon exited: ${job.stderr}`);
    try {
      const response = await fetch(`${base}/api/projects`, { signal: AbortSignal.timeout(1500) });
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        const meta = await response.json();
        assert.equal(meta.projects.length, 1);
        assert.equal(meta.projects[0].name, state.projectName);
        await save();
        return { job, base };
      }
    } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Daemon readiness timed out: ${job.stderr}`);
}

try {
  if (phase === 'prepare') {
    assert.equal(process.platform, 'win32');
    const bun = required('bun'), git = required('git');
    const repo = await getJson('https://api.github.com/repos/aylith-labs/tickets', 'github-repository.json');
    assert.equal(repo.full_name, 'aylith-labs/tickets');
    assert.equal(repo.private, false);
    const release = await getJson('https://api.github.com/repos/aylith-labs/tickets/releases/tags/v0.1.3', 'github-release.json');
    assert.equal(release.tag_name, 'v0.1.3');
    assert.equal(release.draft, false);
    const ref = await getJson('https://api.github.com/repos/aylith-labs/tickets/git/ref/tags/v0.1.3', 'github-tag.json');
    assert.equal(ref.object.sha, 'cd5746deaf441279dd6e2325a130dec7e7e48fd8');
    const asset = release.assets.find((item) => item.name === 'tickets-windows-x64.exe');
    const exactUrl = 'https://github.com/aylith-labs/tickets/releases/download/v0.1.3/tickets-windows-x64.exe';
    assert.equal(asset.browser_download_url, exactUrl);
    assert.match(asset.digest, /^sha256:[a-f0-9]{64}$/);
    const binary = join(root, asset.name);
    const bytes = await download(exactUrl, binary);
    assert.equal(bytes.length, asset.size);
    assert.equal(`sha256:${sha(bytes)}`, asset.digest);
    assert.equal(bytes.toString('ascii', 0, 2), 'MZ');
    const peOffset = bytes.readUInt32LE(0x3c);
    assert.equal(bytes.toString('ascii', peOffset, peOffset + 4), 'PE\0\0');
    assert.equal(bytes.readUInt16LE(peOffset + 4), 0x8664);
    await check('official-windows-x64-asset', { releaseId: release.id, assetId: asset.id, publishedAt: release.published_at, tagCommit: ref.object.sha, bytes: bytes.length, sha256: sha(bytes), machine: 'PE AMD64 (0x8664)' });
    for (const name of ['tickets', 'tickets-server', 'tickets-core', 'tickets-ui', 'tickets-tui']) {
      const metadata = await getJson(`https://registry.npmjs.org/@aylith%2f${name}/0.1.3`, `${name}-npm-metadata.json`);
      assert.equal(metadata.name, `@aylith/${name}`);
      assert.equal(metadata.version, '0.1.3');
      assert.equal(metadata.repository.url, 'git+https://github.com/aylith-labs/tickets.git');
      const url = `https://registry.npmjs.org/@aylith/${name}/-/${name}-0.1.3.tgz`;
      assert.equal(metadata.dist.tarball, url);
      const archive = join(root, `${name}-0.1.3.tgz`);
      const packageBytes = await download(url, archive);
      assert.equal(`sha512-${sha(packageBytes, 'sha512', 'base64')}`, metadata.dist.integrity);
      assert.equal(sha(packageBytes, 'sha1'), metadata.dist.shasum);
      const target = join(root, 'npm', name);
      await mkdir(target, { recursive: true });
      const tar = join(process.env.SystemRoot, 'System32', 'tar.exe');
      const listing = await run(tar, ['-tzf', archive], root, process.env, `${name}-tar-list`);
      assert.equal(listing.code, 0);
      const files = listing.stdout.trim().split(/\r?\n/);
      assert(files.every((file) => file.startsWith('package/') && !file.split(/[\\/]/).includes('..')));
      await writeFile(join(root, `${name}-tar-files.txt`), `${files.join('\n')}\n`);
      const extraction = await run(tar, ['-xzf', archive, '-C', target], root, process.env, `${name}-tar-extract`);
      assert.equal(extraction.code, 0);
      const packageJson = JSON.parse(await readFile(join(target, 'package', 'package.json'), 'utf8'));
      assert.equal(packageJson.version, '0.1.3');
      await check(`${name}-tarball`, { bytes: packageBytes.length, sha256: sha(packageBytes), integrity: metadata.dist.integrity, files: files.length, browserAssets: files.filter((file) => /\.(html|css)$|(^|\/)components\.js$|apps\/web\/dist/.test(file)), engines: packageJson.engines, scripts: packageJson.scripts });
    }
    receipt.findings.push('The five npm archives do not bundle the browser app; npm runtime is not installed or tested.');
    const state = { root, binary, binarySha256: sha(bytes), bun, git, node: process.version, createdAt: now() };
    for (const kind of ['default', 'folder']) {
      const profile = join(root, `${kind}-profile`), repoDir = join(root, `${kind}-repo`);
      const env = isolatedEnv(profile, git);
      for (const dir of [repoDir, profile, env.APPDATA, env.LOCALAPPDATA, env.XDG_CONFIG_HOME, env.XDG_CACHE_HOME, env.XDG_DATA_HOME, env.TEMP]) await mkdir(dir, { recursive: true });
      const homeProof = await run(bun, ['-e', 'console.log(JSON.stringify({home:require("node:os").homedir(),bun:Bun.version,platform:process.platform,arch:process.arch}))'], repoDir, env, `${kind}-home-proof`);
      assert.equal(homeProof.code, 0);
      assert.equal(JSON.parse(homeProof.stdout).home, profile);
      assert.equal((await run(git, ['init', '-b', 'main'], repoDir, env, `${kind}-git-init`)).code, 0);
      for (const [key, value] of [['user.name', 'Tickets first-use fixture'], ['user.email', 'tickets-proof@localhost']]) {
        assert.equal((await run(git, ['config', '--local', key, value], repoDir, env, `${kind}-${key}`)).code, 0);
      }
      assert.equal((await run(git, ['commit', '--allow-empty', '-m', 'Initialize isolated first-use fixture'], repoDir, env, `${kind}-initial-commit`)).code, 0);
      assert.equal((await run(git, ['remote', '-v'], repoDir, env, `${kind}-remotes`)).stdout, '');
      if (kind === 'default') {
        await run(binary, ['--version'], repoDir, env, 'binary-version-option');
        await run(git, ['--version'], repoDir, env, 'git-version');
        const initialList = await run(binary, ['list'], repoDir, env, 'default-initial-list');
        assert(initialList.stdout.includes('No projects registered.'));
      }
      const initArgs = kind === 'folder' ? ['init', '--adapter', 'folder'] : ['init'];
      const init = await run(binary, initArgs, repoDir, env, `${kind}-tickets-init`);
      if (init.code !== 0) receipt.findings.push(`${kind} init failed; inspect its command stderr before claiming first-use acceptance.`);
      await check(`${kind}-init-result`, { code: init.code, stdout: init.stdout, stderr: init.stderr });
      if (kind === 'folder') {
        assert.equal(init.code, 0);
        const config = JSON.parse(await readFile(join(profile, '.config', 'aylith-tickets', 'config.json'), 'utf8'));
        assert.equal(config.projects.length, 1);
        assert.equal(config.projects[0].adapter, 'folder');
        assert.equal(resolve(config.projects[0].repoPath), repoDir);
        assert.equal(resolve(config.projects[0].dataDir), join(repoDir, '.tickets'));
        Object.assign(state, { folderProfile: profile, folderRepo: repoDir, folderEnv: env, projectName: config.projects[0].name });
        await json(join(root, 'folder-config-after-init.json'), config);
      }
    }
    await json(join(root, 'state.json'), state);
    const port = await freePort();
    const { job, base } = await start(state, port, 'prepare-serve');
    for (const route of ['/', '/main.js', '/components.js', '/api/projects', '/api/tickets']) {
      const response = await fetch(`${base}${route}`);
      const body = Buffer.from(await response.arrayBuffer());
      await writeFile(join(root, `http-${route === '/' ? 'index.html' : route.slice(1).replaceAll('/', '-')}`), body);
      await check(`HTTP ${route}`, { status: response.status, contentType: response.headers.get('content-type'), bytes: body.length, sha256: sha(body) });
      assert.equal(response.status, 200);
    }
    await stop(job);
  } else if (phase === 'browser') {
    const state = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
    assert.equal(sha(await readFile(state.binary)), state.binarySha256);
    const playwrightDir = required('playwright');
    const { chromium } = await import(pathToFileURL(join(playwrightDir, 'index.mjs')).href);
    const playwrightVersion = JSON.parse(await readFile(join(playwrightDir, 'package.json'), 'utf8')).version;
    const port = await freePort();
    let { job, base } = await start(state, port, 'browser-serve-1');
    const get = async (route) => {
      const response = await fetch(`${base}${route}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200);
      assert(response.headers.get('content-type')?.includes('application/json'));
      return response.json();
    };
    const meta = await get('/api/projects');
    await json(join(root, 'browser-projects.json'), meta);
    assert.deepEqual((await get('/api/tickets')).tickets, []);
    const profile = join(root, 'browser-profile');
    browser = await chromium.launchPersistentContext(profile, {
      executablePath: chromium.executablePath(), headless: true, viewport: { width: 1280, height: 900 },
      env: state.folderEnv, colorScheme: 'light', reducedMotion: 'reduce',
    });
    const browserRecord = { label: 'playwright-chromium', startedAt: now(), executable: chromium.executablePath(), profile, version: browser.browser().version(), playwrightVersion };
    receipt.jobs.push(browserRecord);
    await browser.tracing.start({ screenshots: true, snapshots: true });
    receipt.requests = [];
    receipt.responses = [];
    receipt.pageErrors = [];
    receipt.consoleErrors = [];
    const page = browser.pages()[0] || await browser.newPage();
    page.setDefaultTimeout(12000);
    page.on('request', (request) => receipt.requests.push({ at: now(), method: request.method(), url: request.url() }));
    page.on('response', (response) => receipt.responses.push({ at: now(), status: response.status(), url: response.url() }));
    page.on('pageerror', (error) => receipt.pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') receipt.consoleErrors.push(message.text()); });
    const screenshot = async (name) => {
      await page.screenshot({ path: join(root, `${name}.png`), fullPage: true });
      await writeFile(join(root, `${name}.aria.txt`), `${await page.locator('body').ariaSnapshot()}\n`);
    };
    const responseFor = (method) => page.waitForResponse((response) => response.request().method() === method && new URL(response.url()).pathname.startsWith('/api/tickets'));
    try {
      await page.goto(base, { waitUntil: 'domcontentloaded' });
      await page.getByText('No tickets yet — capture the first one above.', { exact: true }).waitFor();
      await screenshot('browser-01-empty');
      await page.getByRole('link', { name: state.projectName, exact: true }).click();
      assert.equal(new URL(page.url()).pathname, `/${state.projectName}`);
      await page.getByText('No tickets yet — capture the first one above.', { exact: true }).waitFor();
      await check('fresh-browser-empty-project', { base, project: state.projectName, browser: browserRecord.version, playwrightVersion });
      const title = 'AYL-002 first-use proof';
      const description = 'Created through the published Windows UI.\nVerify local persistence without agent setup.';
      const form = page.locator('ay-ticket-form');
      await form.locator('input[name="title"]').fill(title);
      await form.locator('textarea[name="description"]').fill(description);
      const creation = responseFor('POST');
      await form.getByRole('button', { name: 'Create ticket', exact: true }).focus();
      await page.keyboard.press('Enter');
      const createdResponse = await creation;
      assert.equal(createdResponse.status(), 201);
      const created = await createdResponse.json();
      assert.equal(created.title, title);
      assert.equal(created.description, description);
      assert.equal(created.project, state.projectName);
      receipt.ticketId = created.id;
      await page.locator('ay-ticket-card').getByText(title, { exact: true }).waitFor();
      assert.equal((await get('/api/tickets')).tickets.length, 1);
      await screenshot('browser-02-created');
      await check('browser-created-ticket', created);
      await page.locator('ay-ticket-card').getByText(title, { exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByRole('button', { name: 'Edit', exact: true }).click();
      const editedTitle = `${title} — edited`;
      const editedDescription = `${description}\nEdited in the real browser before process restart.`;
      await dialog.locator('input[name="title"]').fill(editedTitle);
      await dialog.locator('textarea[name="description"]').fill(editedDescription);
      const saving = responseFor('PATCH');
      await dialog.getByRole('button', { name: 'Save', exact: true }).click();
      const savedResponse = await saving;
      assert.equal(savedResponse.status(), 200);
      const saved = await savedResponse.json();
      assert.equal(saved.title, editedTitle);
      assert.equal(saved.description, editedDescription);
      await dialog.getByRole('heading', { name: editedTitle, exact: true }).waitFor();
      const status = meta.statuses.includes('in_progress') ? 'in_progress' : meta.statuses[1];
      const changingStatus = responseFor('PATCH');
      await dialog.getByLabel('Status', { exact: true }).selectOption(status);
      const statusResponse = await changingStatus;
      assert.equal(statusResponse.status(), 200);
      assert.equal((await statusResponse.json()).status, status);
      await screenshot('browser-03-edited');
      await check('browser-edited-and-status-saved', { id: created.id, title: editedTitle, description: editedDescription, status });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('ay-ticket-card').getByText(editedTitle, { exact: true }).click();
      await dialog.getByRole('heading', { name: editedTitle, exact: true }).waitFor();
      assert.equal(await dialog.locator('.description').textContent(), editedDescription);
      assert.equal(await dialog.getByLabel('Status', { exact: true }).inputValue(), status);
      await check('browser-reload-retains-edit', { id: created.id, url: page.url() });
      const route = `/api/tickets/${encodeURIComponent(state.projectName)}/${encodeURIComponent(created.id)}`;
      const before = await get(route);
      await json(join(root, 'ticket-before-restart.json'), before);
      const storeDir = join(state.folderRepo, '.tickets', 'tickets');
      const storeFiles = await readdir(storeDir);
      receipt.storeFiles = storeFiles;
      for (const file of storeFiles) {
        const body = await readFile(join(storeDir, file));
        await writeFile(join(root, `stored-before-${file}`), body);
      }
      await stop(job);
      let unavailable = false;
      try { await fetch(`${base}/api/projects`, { signal: AbortSignal.timeout(1500) }); } catch { unavailable = true; }
      assert(unavailable, 'The old daemon must actually be stopped');
      await check('daemon-stopped-confirmed', { pid: job.record.pid, exitCode: job.record.exitCode, signal: job.record.signal, port });
      ({ job, base } = await start(state, port, 'browser-serve-2'));
      const after = await get(route);
      assert.deepEqual(after, before);
      assert.equal((await get('/api/tickets')).tickets.length, 1);
      await json(join(root, 'ticket-after-restart.json'), after);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.locator('ay-ticket-card').getByText(editedTitle, { exact: true }).click();
      await dialog.getByRole('heading', { name: editedTitle, exact: true }).waitFor();
      assert.equal(await dialog.locator('.description').textContent(), editedDescription);
      assert.equal(await dialog.getByLabel('Status', { exact: true }).inputValue(), status);
      await screenshot('browser-04-restarted');
      await check('process-restart-and-browser-reload-persist', { id: created.id, oldPid: receipt.jobs[0].pid, newPid: job.record.pid, fullTicketEqual: true, tickets: 1 });
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('link', { name: 'all', exact: true }).click();
      await page.locator('ay-ticket-card').getByText(editedTitle, { exact: true }).waitFor();
      assert.equal(new URL(page.url()).pathname, '/');
      await page.getByRole('button', { name: 'Theme', exact: true }).click();
      await page.getByRole('button', { name: 'Theme', exact: true }).click();
      assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
      await screenshot('browser-05-dark');
      await page.setViewportSize({ width: 390, height: 844 });
      await screenshot('browser-06-narrow');
      const layout = await page.evaluate(() => {
        const controls = [];
        const visit = (rootNode) => {
          for (const element of rootNode.querySelectorAll('*')) {
            if (element.shadowRoot) visit(element.shadowRoot);
            if (element.matches('input,select,textarea,button,a')) {
              const rect = element.getBoundingClientRect();
              if (rect.width && rect.height) controls.push({ tag: element.tagName, name: element.getAttribute('name') || element.textContent?.trim().slice(0, 60), x: rect.x, right: rect.right, width: rect.width });
            }
          }
        };
        visit(document);
        return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, overflowControls: controls.filter((item) => item.x < 0 || item.right > innerWidth) };
      });
      await check('narrow-layout-observation', layout);
      if (layout.documentWidth > layout.viewport || layout.overflowControls.length) receipt.findings.push('Narrow layout overflows the viewport.');
      assert.deepEqual(receipt.pageErrors, []);
      assert(receipt.requests.every((request) => new URL(request.url).origin === base));
      assert(receipt.requests.every((request) => !/\/(launch|enrich|attachments|prompt|restore)(\/|$)/.test(new URL(request.url).pathname)));
      await check('bounded-network-and-page-errors', { requests: receipt.requests.length, pageErrors: receipt.pageErrors, consoleErrors: receipt.consoleErrors });
    } catch (error) {
      await screenshot('browser-failure').catch(() => {});
      throw error;
    } finally {
      await browser.tracing.stop({ path: join(root, 'browser-trace.zip') });
      await browser.close();
      browser = undefined;
      browserRecord.exitedAt = now();
      await save();
    }
  } else {
    throw new Error('Expected prepare or browser');
  }
  receipt.result = receipt.findings.length ? 'completed-with-findings' : 'completed';
} catch (error) {
  receipt.result = 'failed';
  receipt.error = error.stack || String(error);
  process.exitCode = 1;
  console.error(receipt.error);
} finally {
  if (browser) await browser.close();
  for (const job of live) await stop(job);
  receipt.finishedAt = now();
  await save();
  console.log(JSON.stringify({ result: receipt.result, receiptFile, root }));
}
