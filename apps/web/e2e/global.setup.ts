import path from "node:path";
import { clerk, clerkSetup } from "@clerk/testing/playwright";
import { expect, test as setup } from "@playwright/test";

setup.describe.configure({ mode: "serial" });

setup("clerk testing token", async () => {
  await clerkSetup();
});

setup("sign in the e2e user", async ({ page }) => {
  setup.skip(
    !process.env.E2E_CLERK_USER_EMAIL,
    "set E2E_CLERK_USER_EMAIL to a user in the Clerk dev instance",
  );
  await page.goto("/");
  // emailAddress sign-in mints a server-side token: no password, no OTP.
  await clerk.signIn({ page, emailAddress: process.env.E2E_CLERK_USER_EMAIL! });
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: /search or ask/ })).toBeVisible();
  await page.context().storageState({ path: path.join(__dirname, "../playwright/.clerk/user.json") });
});
