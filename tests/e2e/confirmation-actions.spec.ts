import { expect, test } from "@playwright/test";

// Exercise the real shared control without requiring employee records or mutations.
test("consequential actions require confirmation and remain retryable", async ({ page }) => {
  test.setTimeout(30_000);
  page.on("pageerror", (error) => console.error(error.message));
  await page.route("**/__confirmation-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><body><div id="root"></div><script type="module">
        import RefreshRuntime from '/@react-refresh';
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        const { default: React } = await import('/node_modules/.vite/deps/react.js');
        const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js');
        const { ConfirmAction } = await import('/src/components/ui/confirm-action.tsx');
        window.attempts = 0;
        ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(ConfirmAction, {
          title: 'Remove saved item?',
          description: 'This removes the saved item.',
          confirmLabel: 'Remove item',
          onConfirm: async () => {
            window.attempts++;
            await new Promise(resolve => { window.finishAction = resolve; });
            if (window.attempts === 1) throw new Error('Please retry');
          },
        }, React.createElement('button', null, 'Delete')));
      </script></body></html>`,
    }),
  );
  await page.goto("/__confirmation-test");
  const trigger = page.getByRole("button", { name: "Delete", exact: true });
  await trigger.click();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await page.evaluate("window.attempts")).toBe(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await trigger.click();
  await page.getByRole("button", { name: "Remove item", exact: true }).click();
  await expect(page.getByRole("button", { name: "Please wait…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  expect(await page.evaluate("window.attempts")).toBe(1);
  await page.evaluate("window.finishAction()");
  await expect(page.getByRole("alert")).toHaveText("Please retry");
  await page.getByRole("button", { name: "Remove item", exact: true }).click();
  expect(await page.evaluate("window.attempts")).toBe(2);
  await page.evaluate("window.finishAction()");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});
