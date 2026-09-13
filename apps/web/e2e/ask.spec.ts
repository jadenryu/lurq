import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";

test.skip(!process.env.E2E_CLERK_USER_EMAIL, "needs a signed-in Clerk test user");

test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
  // Never spend a real question: a canned answer stands in for the agent.
  await page.route("**/api/ask", (route) =>
    route.fulfill({ status: 200, contentType: "text/plain; charset=utf-8", body: "stub answer" }),
  );
});

// The regression: a sentence always shared a keyword with some catalog entry,
// so Enter copied that entry's command instead of asking.
test("Enter on a typed question opens Ask instead of copying a command", async ({ page }) => {
  const question = "which repo is worst off?";
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /search or ask/ }).click();

  const box = page.getByRole("textbox", { name: /search what lurq can do/i });
  await box.fill(question);
  await expect(page.getByRole("option").first()).toContainText(`“${question}”`);
  await box.press("Enter");

  // `$`: the ?q= handoff is dropped so a refresh does not ask again.
  await expect(page).toHaveURL(/\/dashboard\/ask$/);
  await expect(page.getByText(question)).toBeVisible();
  await expect(page.getByText("stub answer")).toBeVisible();
});
