import { expect, test } from "@playwright/test";

test("organogram uses connected levels and supports collapse on desktop and mobile", async ({
  page,
}, testInfo) => {
  test.setTimeout(45_000);
  await page.route("**/__org-chart-test", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/src/styles.css');
      const {default: React} = await import('/node_modules/.vite/deps/react.js');
      const {default: ReactDOM} = await import('/node_modules/.vite/deps/react-dom_client.js');
      const {OrgChartTree} = await import('/src/components/org-chart-tree.tsx');
      const person = (id, name, position, location) => ({id, preferredName:name, legalName:name, position, location, department:'VIA International'});
      const ceo = person('ceo', 'Company Leader', 'Chief Executive Officer', 'Head Office');
      const oman = person('oman', 'Oman Manager', 'Country Manager', 'Muscat');
      const uae = person('uae', 'UAE Manager', 'Country Manager', 'Dubai');
      const hr = person('hr', 'HR Colleague', 'Human Resources', 'Muscat');
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('main', {className:'p-6 bg-muted/20 min-h-screen'},
        React.createElement('h1', {className:'text-2xl font-semibold mb-8'}, 'Organisation chart'),
        React.createElement('div', {style:{overflow:'auto'}, role:'region', 'aria-label':'Chart'},
          React.createElement('div', {className:'w-max min-w-full p-6'},
            React.createElement(OrgChartTree, {person:ceo, headId:'ceo', matches:new Set(), childrenByManager:new Map([['ceo',[oman,uae]], ['oman',[hr]]])})))));
    </script></body></html>`,
    }),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/__org-chart-test");
  await expect(page.getByText("Company head", { exact: true })).toBeVisible();
  const head = await page.getByText("Company Leader", { exact: true }).boundingBox();
  const country = await page.getByText("Oman Manager", { exact: true }).boundingBox();
  const colleague = await page.getByText("HR Colleague", { exact: true }).boundingBox();
  expect(head!.y).toBeLessThan(country!.y);
  expect(country!.y).toBeLessThan(colleague!.y);
  await page.screenshot({ path: testInfo.outputPath("organogram-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Collapse Oman Manager's team" }).click();
  await expect(page.getByText("HR Colleague", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Expand Oman Manager's team" }).click();
  await expect(page.getByText("HR Colleague", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: testInfo.outputPath("organogram-mobile.png"), fullPage: true });
});
