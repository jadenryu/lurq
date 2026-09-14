import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

// A new visitor, not the shared signed-in e2e user.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
});

// The regression: ClerkProvider forced /dashboard after sign-up, which beats
// `redirect_url`, so pricing's "Start Pro" lost the visitor on the way back.
// Clerk dev instances accept +clerk_test addresses with the code 424242.
test("a new account returns to its redirect_url, not the dashboard", async ({ page }) => {
  const id = Date.now();
  await page.goto("/sign-up?redirect_url=%2Fabout");

  const form = page.locator(".cl-rootBox");
  await form.locator('input[name="emailAddress"]').fill(`lurq-e2e-${id}+clerk_test@example.com`);
  if (await form.locator('input[name="username"]').count()) {
    await form.locator('input[name="username"]').fill(`e2e${id}`);
  }
  if (await form.locator('input[name="password"]').count()) {
    await form.locator('input[name="password"]').fill(`E2e-${id}-password!`);
  }
  await form.locator(".cl-formButtonPrimary").click();

  await page.locator('input[autocomplete="one-time-code"]').first().pressSequentially("424242");
  await expect(page).toHaveURL(/\/about$/, { timeout: 30_000 });
});
