import { test, expect } from '@playwright/test';

test.describe('AuthClaw E2E Console Verification', () => {

  test('complete app shell flow', async ({ page }) => {
    const email = process.env.E2E_LOGIN_EMAIL || 'admin@authclaw-lite.demo';
    const apiKey = process.env.E2E_LOGIN_API_KEY || 'acl_lite_demo_key';

    // 1. Login
    await page.goto('/login');
    await expect(page.locator('h1')).toContainText('AuthClaw Console');

    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', apiKey);
    await page.click('button[type="submit"]');

    // Wait for Overview page redirect
    await page.waitForURL('/overview');
    await expect(page).toHaveURL(/.*overview/);
    await expect(page.locator('body')).toContainText('Overview');

    // 2. Dashboard metrics checks
    await expect(page.locator('body')).toContainText('Total API calls intercepted');

    // 3. Navigate to Audit Explorer & inspector check
    await page.goto('/audit');
    await expect(page.locator('h1')).toContainText('Audit Explorer');
    
    // Wait for the table to load
    await page.waitForSelector('table');
    
    // Check if there are rows in the table
    const rowsCount = await page.locator('table tbody tr').count();
    if (rowsCount > 0) {
      // Click the first row
      await page.locator('table tbody tr').first().click();
      
      // Verify Event Inspector slide-out is open and displays record details
      await expect(page.locator('body')).toContainText('Event Inspector');
      await expect(page.locator('body')).toContainText('Raw Event JSON');
      
      // Close Event Inspector by clicking the backdrop
      await page.locator('div.fixed.inset-0.bg-black\\/60').click({ force: true });
    }

    // 4. Navigate to Compliance Agent
    await page.goto('/agent');
    await expect(page.locator('h1')).toContainText('Compliance Agent & Orchestrator');

    // Start a new chat session
    await page.click('button:has-text("New Chat")');
    
    // Wait for new chat input placeholder to become active
    const chatInput = page.locator('input[placeholder="Ask the Compliance Agent..."]');
    await expect(chatInput).toBeVisible();

    // Send a message
    await chatInput.fill('Run GDPR compliance scan');
    await page.click('form button[type="submit"]');

    // Wait for agent message reply
    await page.waitForSelector('pre:has-text("Initiating GDPR compliance scan")');
    await expect(page.locator('body')).toContainText('Initiating GDPR');

    // Check active scans ledger
    await page.click('button:has-text("Active Scans Ledger")');
    await expect(page.locator('body')).toContainText('GDPR framework');
  });
});
