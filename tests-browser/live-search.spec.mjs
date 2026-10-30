import { test, expect } from '@playwright/test';
import { MARKETPLACES } from '../lib/marketplaces.js';

// Opt-in: acessa lojas reais, sem substituir respostas de rede. Os resultados
// e bloqueios dependem do marketplace, então não se exige um total de produtos.
test('coleta real: oito sites e uma URL Shopee no navegador', async ({ page }) => {
  test.skip(process.env.RUN_LIVE_SEARCH !== '1', 'Defina RUN_LIVE_SEARCH=1 para acessar marketplaces reais.');
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const sites = MARKETPLACES.map(m => m.id).join(',');
  await page.goto(`/?q=fone&min=170&max=200&sites=${sites}&pages=1&international=0`);
  await expect(page.getByRole('button', { name: 'Garimpar agora' })).toBeEnabled();
  await page.locator('.step-advanced > summary').click();
  await page.getByLabel('URLs de busca extras').fill('https://shopee.com.br/search?keyword=fone&page=0');
  const apiResponse = page.waitForResponse('**/api/collect');
  await page.getByRole('button', { name: 'Garimpar agora' }).click();
  expect((await apiResponse).status()).toBe(200);
  await expect(page.locator('.status')).toContainText(/Coleta concluída|Concluída com avisos/, { timeout: 75_000 });
  await expect(page.locator('.source')).toHaveCount(4);
  await expect(page.locator('.market-filter button')).toHaveCount(9);
  await expect(page.locator('.external-search')).toHaveCount(9);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ fontes: await page.locator('.source').allTextContents(), produtos: await page.locator('.grid .card:not(.skeleton)').count(), links: await page.locator('.external-search').count() }));
  await page.locator('.results').screenshot({ path: 'test-results/coleta-real.png' });
  await page.locator('.market-filter').getByRole('button', { name: /Americanas/ }).click();
  await page.locator('.market-filter').evaluate(element => { element.scrollIntoView({ block: 'start' }); window.scrollBy(0, -90); });
  if (await page.locator('.grid .card img').count()) {
    await expect.poll(() => page.locator('.grid .card img').first().evaluate(image => image.naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0);
  }
  await page.screenshot({ path: 'test-results/filtro-americanas.png' });
});
