import { expect, test } from "@playwright/test";

test("shared forms and buttons block rapid repeats and unlock after completion", async ({
  page,
}) => {
  await page.route("**/__submission-test", (route) =>
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
      const { SafeForm } = await import('/src/components/ui/safe-form.tsx');
      const { Button } = await import('/src/components/ui/button.tsx');
      window.attempts = 0;
      window.buttonAttempts = 0;
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('div', null,
        React.createElement(SafeForm, {id:'upload-form', onSubmit:async (event) => {
          event.preventDefault(); window.attempts++;
          await new Promise(resolve => { window.finishUpload = resolve; });
        }}, React.createElement(Button, {type:'submit'}, 'Upload')),
        React.createElement(Button, {id:'save-button', onClick:async () => {
          window.buttonAttempts++;
          await new Promise(resolve => { window.finishSave = resolve; });
        }}, 'Save')));
    </script></body></html>`,
    }),
  );
  await page.goto("/__submission-test");
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeVisible();
  await page.evaluate(
    `for (let i=0;i<6;i++) document.getElementById('upload-form').requestSubmit()`,
  );
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeDisabled();
  expect(await page.evaluate("window.attempts")).toBe(1);
  await page.evaluate("window.finishUpload()");
  await expect(page.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  expect(await page.evaluate("window.attempts")).toBe(2);
  await page.evaluate("window.finishUpload()");
  await page.evaluate(`for (let i=0;i<6;i++) document.getElementById('save-button').click()`);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  expect(await page.evaluate("window.buttonAttempts")).toBe(1);
  await page.evaluate("window.finishSave()");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});
