import { expect, test } from '../apps/web/node_modules/@playwright/test';

test('immutable project route selects the renamed project and creates a persisted ticket', async ({ page }) => {
	await page.goto('/synthetic-stable-01');
	const chip = page.getByRole('link', { name: 'Renamed synthetic project', exact: true });
	await expect(chip).toHaveAttribute('href', '/synthetic-stable-01');
	await expect(chip).toHaveClass(/active/);
	await expect(page.locator('#project-info')).toContainText('folder');
	await page.getByPlaceholder('What needs fixing or building?').fill('SYNTHETIC identity proof');
	await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
	await expect(page.locator('ay-ticket-card')).toContainText('SYNTHETIC identity proof');
	await page.reload();
	await expect(page.locator('ay-ticket-card')).toContainText('SYNTHETIC identity proof');
});

test('a ticket opened from all projects has a stable link that survives reload', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /^(Close|New ticket)$/ }).waitFor();
	if (await page.getByRole('button', { name: 'New ticket' }).isVisible()) {
		await page.getByRole('button', { name: 'New ticket' }).click();
	}
	await page.getByPlaceholder('What needs fixing or building?').fill('SYNTHETIC linked ticket');
	await page.getByRole('combobox', { name: 'Project' }).selectOption('synthetic-stable-01');
	await page.getByRole('button', { name: 'Create ticket', exact: true }).click();
	await page.locator('ay-ticket-card').filter({ hasText: 'SYNTHETIC linked ticket' }).click();
	await page.getByRole('link', { name: 'Open ticket link' }).click();
	await expect(page).toHaveURL(/\/synthetic-stable-01\?ticket=\d+$/);
	await expect(page.getByRole('dialog', { name: /^Ticket \d+$/ })).toContainText('SYNTHETIC linked ticket');
	await page.reload();
	await expect(page.getByRole('dialog', { name: /^Ticket \d+$/ })).toContainText('SYNTHETIC linked ticket');
});

test('legacy name resolves to canonical ID without losing query or fragment', async ({ page }) => {
	await page.goto('/Renamed%20synthetic%20project?view=board#review');
	await expect(page).toHaveURL(/\/synthetic-stable-01\?view=board#review$/);
	await expect(page.getByRole('link', { name: 'Renamed synthetic project', exact: true })).toHaveClass(/active/);
});

test('malformed route is recoverable instead of a blank app', async ({ page }) => {
	await page.goto('/%E0%A4%A');
	await expect(page.getByRole('alert')).toContainText('Invalid project URL');
	await page.getByRole('link', { name: 'All projects', exact: true }).click();
	await expect(page.locator('ay-ticket-list')).toBeVisible();
});

test('unknown project cannot silently open an unscoped creation form', async ({ page }) => {
	await page.goto('/does-not-exist');
	await expect(page.getByRole('alert')).toContainText('Project not found');
	await expect(page.locator('ay-ticket-list')).toHaveCount(0);
	await page.getByRole('link', { name: 'All projects', exact: true }).click();
	await expect(page.locator('ay-ticket-list')).toBeVisible();
});
