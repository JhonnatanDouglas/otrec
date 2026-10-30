import { test } from '@playwright/test';

test('diagnostica busca Casas Bahia', async ({ page }) => {
  test.skip(process.env.RUN_LIVE_SEARCH !== '1', 'Defina RUN_LIVE_SEARCH=1 para acessar marketplaces reais.');
  test.setTimeout(90_000);
  page.on('response', async response => {
    if (/busca|search|autocomplete|product/i.test(response.url())) {
      const body = await response.text().catch(() => '');
      console.log(`CASAS_RESPONSE ${response.status()} ${response.url()} ${body.slice(0, 3000)}`);
    }
  });
  const response = await page.goto('https://www.casasbahia.com.br/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  console.log(`CASAS_HOME ${response?.status()} ${page.url()}`);
  const inputs = await page.locator('input').evaluateAll(nodes => nodes.map(node => ({ name: node.name, id: node.id, placeholder: node.placeholder, type: node.type })));
  console.log(`CASAS_INPUTS ${JSON.stringify(inputs)}`);
  const search = page.locator('input').filter({ has: undefined }).first();
  const candidate = page.locator('input[placeholder*="Busc" i], input[type="search"], input[name*="search" i]').first();
  if (await candidate.count()) {
    await candidate.fill('fone');
    await page.waitForTimeout(5_000);
  } else if (await search.count()) {
    await search.fill('fone');
    await page.waitForTimeout(5_000);
  }
});
