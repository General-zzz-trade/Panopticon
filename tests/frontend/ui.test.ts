import { test, expect } from '@playwright/test';

test.beforeAll(async ({ }, testInfo) => {
  // Check that the server is reachable before running tests
  const res = await fetch('http://localhost:3000/api/v1/health').catch(() => null);
  if (!res || !res.ok) {
    throw new Error(
      'Server at localhost:3000 is not reachable. Start it with `npm run api` before running frontend tests.'
    );
  }
});

test.describe('Agent Orchestrator UI', () => {

  test('page loads with correct title', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Agent Orchestrator');
  });

  test('empty state shows suggestion buttons', async ({ page }) => {
    await page.goto('/');
    const suggestions = page.locator('.suggest-btn');
    await expect(suggestions).toHaveCount(4);
    // Verify each suggestion is visible
    for (let i = 0; i < 4; i++) {
      await expect(suggestions.nth(i)).toBeVisible();
    }
  });

  test('clicking suggestion fills textarea', async ({ page }) => {
    await page.goto('/');
    const textarea = page.locator('#user-input');
    await expect(textarea).toHaveValue('');

    const firstSuggestion = page.locator('.suggest-btn').first();
    const expectedPrompt = await firstSuggestion.getAttribute('data-prompt');
    await firstSuggestion.click();

    await expect(textarea).toHaveValue(expectedPrompt!);
  });

  test('sidebar toggle works', async ({ page }) => {
    await page.goto('/');
    const sidebar = page.locator('#sidebar');
    const toggleBtn = page.locator('#sidebar-toggle');

    // Sidebar should be visible initially
    await expect(sidebar).toBeVisible();
    await expect(sidebar).not.toHaveClass(/collapsed/);

    // Click toggle to collapse
    await toggleBtn.click();
    await expect(sidebar).toHaveClass(/collapsed/);

    // Click toggle to expand
    await toggleBtn.click();
    await expect(sidebar).not.toHaveClass(/collapsed/);
  });

  test('right panel toggle works', async ({ page }) => {
    await page.goto('/');
    const rightPanel = page.locator('#right-panel');
    const toggleBtn = page.locator('#right-toggle');

    // Toggle to collapse the right panel
    await toggleBtn.click();
    await expect(rightPanel).toHaveClass(/collapsed/);

    // Toggle to expand
    await toggleBtn.click();
    await expect(rightPanel).not.toHaveClass(/collapsed/);
  });

  test('dark mode toggle works', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    const themeBtn = page.locator('#theme-toggle');

    // Toggle dark mode on
    await themeBtn.click();
    await expect(html).toHaveClass(/dark/);

    // Toggle dark mode off
    await themeBtn.click();
    await expect(html).not.toHaveClass(/dark/);
  });

  test('settings modal opens and closes', async ({ page }) => {
    await page.goto('/');
    const settingsModal = page.locator('#settings-modal');

    // Initially hidden
    await expect(settingsModal).toHaveClass(/hidden/);

    // Open settings
    await page.locator('#open-settings').click();
    await expect(settingsModal).not.toHaveClass(/hidden/);

    // Close by clicking the close button inside the modal
    await settingsModal.locator('button[aria-label="Close"]').click();
    await expect(settingsModal).toHaveClass(/hidden/);
  });

  test('dashboard modal opens and closes', async ({ page }) => {
    await page.goto('/');
    const dashboardModal = page.locator('#dashboard-modal');

    // Initially hidden
    await expect(dashboardModal).toHaveClass(/hidden/);

    // Open dashboard
    await page.locator('#open-dashboard').click();
    await expect(dashboardModal).not.toHaveClass(/hidden/);

    // Close by clicking the close button inside the modal
    await dashboardModal.locator('button:has-text("×")').click();
    await expect(dashboardModal).toHaveClass(/hidden/);
  });

  test('sending a message shows agent response area', async ({ page }) => {
    await page.goto('/');
    const textarea = page.locator('#user-input');
    const sendBtn = page.locator('#send-btn');

    // Type a message
    await textarea.fill('Hello agent');
    await expect(sendBtn).toBeEnabled();

    // Submit the form
    await sendBtn.click();

    // The messages container should have content (agent response area appears)
    const messages = page.locator('#messages');
    await expect(messages).not.toBeEmpty({ timeout: 10_000 });
  });

  test('keyboard shortcut Ctrl+K focuses textarea', async ({ page }) => {
    await page.goto('/');
    const textarea = page.locator('#user-input');

    // Click somewhere else first to blur textarea
    await page.locator('#chat').click();

    // Press Ctrl+K
    await page.keyboard.press('Control+k');

    // Textarea should be focused
    await expect(textarea).toBeFocused();
  });

});
