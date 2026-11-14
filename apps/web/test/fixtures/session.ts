import type { Page } from "playwright";

/**
 * Clicks "Sign out" and waits for the logout request to finish.
 * Navigating straight after the click (for example to /login) used to abort the in-flight
 * POST /auth/logout; the session then stayed valid, /login showed the workspace instead of the
 * sign-in form, and the next sign-in timed out waiting for the Email field.
 */
export async function signOut(page: Page) {
  const loggedOut = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/auth/logout") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await loggedOut;
}
