import { BrowserSession } from "./browser";

export async function assertTextVisible(
  session: BrowserSession,
  text: string,
  timeoutMs = 5000
): Promise<void> {
  // Use .first() to avoid strict mode violation when multiple elements match
  const locator = session.page.getByText(text, { exact: false }).first();
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
}
