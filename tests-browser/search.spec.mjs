import { test, expect } from '@playwright/test';
import { MARKETPLACES } from '../lib/marketplaces.js';
import { POST } from '../app/api/collect/route.js';

const allSites = MARKETPLACES.map(m => m.id).join(',');
const shopee = 'https://shopee.com.br/search?keyword=fone&fe_filter_options=%5B%5D&page=0';
const query = `/?q=fone&min=170&max=200&sites=${allSites}&pages=1&international=0`;

// Somente as respostas dos marketplaces são simuladas. A configuração, o
// coletor, o Route Handler e a interface usados no teste são os reais.
async function fulfillCollection(route, blocked = false, aliOrigin = 'BR') {
  const originalFetch = global.fetch;
  const requested = [];
  global.fetch = async raw => {
    const url = new URL(raw);
    requested.push(url.hostname);
    if (blocked) return new Response('', { status: 403 });
    let body;
    if (url.hostname.includes('amazon')) {
      body = '<div data-component-type="s-search-result" data-asin="B0TEST1234"><h2>Fone Amazon teste</h2><span class="a-price"><span class="a-offscreen">R$ 180,00</span></span></div>';
    } else if (url.hostname.includes('kabum')) {
      body = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data: { catalogServer: { data: [{ code: 42, name: 'Fone KaBuM teste', priceWithDiscount: 185, available: true }], pagination: { current: 1, next: 0, total: 1 } } } } } })}</script>`;
    } else if (url.hostname.includes('americanas')) {
      body = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data: { search: { products: { edges: [{ node: { sku: '45', name: 'Fone Americanas teste', link: '/fone-45/p', offers: { offers: [{ availability: 'https://schema.org/InStock', price: 180, quantity: 1 }] } } }], pageInfo: { totalCount: 1 } } } } } } })}</script>`;
    } else {
      body = `<script>/*init-data-start*/ window._dida_config_._init_data_={ data: ${JSON.stringify({ data: { root: { fields: { mods: { itemList: { content: [{ productId: '123456789', title: { displayTitle: 'Fone Ali teste' }, prices: { salePrice: { minPrice: 190 } }, trace: { pdpParams: { pdp_cdi: encodeURIComponent(JSON.stringify({ shipFrom: aliOrigin })) } } }] } } } } }, global: { screenPagination: { hasNext: false, current: 1, total: 1 } } })} };/*init-data-end*/</script>`;
    }
    return new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  };
  try {
    const response = await POST(new Request('http://localhost/api/collect', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Token': process.env.APP_TOKEN || '' }, body: route.request().postData(),
    }));
    // Sem newline final: também verifica que o último snapshot não se perde.
    await route.fulfill({ status: response.status, contentType: response.headers.get('Content-Type'), body: (await response.text()).trimEnd() });
    return requested;
  } finally { global.fetch = originalFetch; }
}

async function extraUrls(page, urls) {
  await page.locator('.step-advanced > summary').click();
  await page.getByLabel('URLs de busca extras').fill(urls);
}

test('reproduz oito lojas + URL Shopee: gera links e coleta quatro fontes', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let requested;
  await page.route('**/api/collect', async route => { requested = await fulfillCollection(route); });
  await page.goto(query);
  await expect(page.getByRole('button', { name: 'Garimpar agora' })).toBeEnabled();
  await extraUrls(page, shopee);
  await expect(page.locator('.external-search')).toHaveCount(9);
  await page.getByRole('button', { name: 'Garimpar agora' }).click();
  await expect(page.locator('.grid .card:not(.skeleton)')).toHaveCount(4);
  await expect(page.locator('.source-concluido')).toHaveCount(4);
  await expect(page.locator('.status')).toContainText('Coleta concluída');
  expect(requested.sort()).toEqual(['pt.aliexpress.com', 'www.amazon.com.br', 'www.americanas.com.br', 'www.kabum.com.br']);
  await expect(page.locator('.market-filter button')).toHaveCount(9);
  await page.locator('.market-filter').getByRole('button', { name: /Americanas/ }).click();
  await expect(page.locator('.grid .card:not(.skeleton)')).toHaveCount(1);
  await expect(page.locator('.grid .card h3')).toContainText('Fone Americanas teste');
  await page.locator('.market-filter').getByRole('button', { name: /Shopee/ }).click();
  await expect(page.locator('.market-explanation')).toContainText('ainda não tem coleta integrada');
  await expect(page.locator('.grid .card:not(.skeleton)')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('URL inválida persistida não derruba fontes válidas', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('otrec:form:v3', JSON.stringify({ urls: 'https://example.invalid/busca', term: 'fone', pages: 1 }));
  });
  await page.route('**/api/collect', route => fulfillCollection(route));
  await page.goto(query);
  await expect(page.getByRole('button', { name: 'Garimpar agora' })).toBeEnabled();
  await expect(page.getByText(/URL extra ignorada:/)).toBeVisible();
  await page.getByRole('button', { name: 'Garimpar agora' }).click();
  await expect(page.locator('.grid .card:not(.skeleton)')).toHaveCount(4);
  await expect(page.locator('.status')).toContainText('Concluída com avisos');
});

test('AliExpress fica no filtro quando excluído por origem e aparece ao permitir internacionais', async ({ page }) => {
  await page.route('**/api/collect', route => fulfillCollection(route, false, 'CN'));
  await page.goto(query);
  await page.getByRole('button', { name: 'Garimpar agora' }).click();
  await expect(page.locator('.source-concluido')).toHaveCount(4);
  await page.locator('.market-filter').getByRole('button', { name: /AliExpress/ }).click();
  await expect(page.locator('.market-explanation')).toContainText('1 internacionais excluídos');
  await expect(page.locator('.grid .card:not(.skeleton)')).toHaveCount(0);
  await page.locator('.step-price .switch').click();
  await expect(page.getByRole('checkbox', { name: /Excluir compra internacional/ })).not.toBeChecked();
  await page.getByRole('button', { name: 'Garimpar agora' }).click();
  await expect(page.locator('.grid .card:not(.skeleton)')).toHaveCount(4);
  await page.locator('.market-filter').getByRole('button', { name: /AliExpress/ }).click();
  await expect(page.locator('.grid .card h3')).toHaveText('Fone Ali teste');
});

test('somente URLs externas funciona sem chamar coleta', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/collect', route => { requests += 1; return route.abort(); });
  await page.goto('/?sites=');
  await extraUrls(page, shopee);
  await page.getByRole('button', { name: 'Garimpar agora' }).click();
  await expect(page.locator('.status')).toContainText('Buscas externas prontas');
  await expect(page.locator('.external-search')).toHaveAttribute('href', shopee);
  expect(requests).toBe(0);
});

test('403 das fontes mantém oito links clicáveis e informa o motivo', async ({ page }) => {
  await page.route('**/api/collect', route => fulfillCollection(route, true));
  await page.goto(query);
  await page.getByRole('button', { name: 'Garimpar agora' }).click();
  await expect(page.locator('.source-erro')).toHaveCount(4);
  await expect(page.locator('.external-search')).toHaveCount(8);
  await expect(page.getByRole('heading', { name: 'Use a busca direta nos marketplaces' })).toBeVisible();
  await expect(page.locator('.source-error').first()).toContainText('403');
});

test('erro de autenticação mantém os links visíveis', async ({ page }) => {
  await page.route('**/api/collect', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ erro: 'Chave de acesso incorreta.' }) }));
  await page.goto(query);
  await page.getByRole('button', { name: 'Garimpar agora' }).click();
  await expect(page.locator('.feedback')).toContainText('Chave de acesso incorreta.');
  await expect(page.locator('.external-search')).toHaveCount(8);
  await expect(page.locator('.status')).toContainText('Não foi possível coletar');
});

test('stream interrompido informa erro e libera nova busca', async ({ page }) => {
  await page.route('**/api/collect', route => route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'snapshot', data: { status: 'executando' } }) }));
  await page.goto(query);
  await page.getByRole('button', { name: 'Garimpar agora' }).click();
  await expect(page.locator('.feedback')).toContainText('A conexão terminou antes da conclusão');
  await expect(page.getByRole('button', { name: 'Garimpar agora' })).toBeEnabled();
  await expect(page.locator('.external-search')).toHaveCount(8);
});

test('links podem ser abertos pelo cartão antes de iniciar a coleta', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await context.route('https://shopee.com.br/**', route => route.fulfill({ body: '<h1>Destino da busca</h1>', contentType: 'text/html' }));
  await page.goto(query);
  const link = page.getByRole('link', { name: 'Abrir busca na Shopee', exact: true });
  const [popup] = await Promise.all([page.waitForEvent('popup'), link.click()]);
  await popup.waitForLoadState();
  expect(new URL(popup.url()).searchParams.get('keyword')).toBe('fone');
  await popup.close();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test('alterar o produto atualiza links e URLs extras sem manter o termo antigo', async ({ page }) => {
  await page.goto(query);
  await extraUrls(page, 'https://shopee.com.br/search?keyword=fone+de+ouvido&page=0');
  for (const term of ['fone de ouvido', 'controle de video game', 'drone', 'mochila', 'poco x7 pro']) {
    await page.getByRole('textbox', { name: 'Produto', exact: true }).fill(term);
    const links = await page.locator('.external-search').evaluateAll(elements => elements.map(element => element.href));
    expect(links).toHaveLength(9);
    for (const link of links.filter(raw => new URL(raw).hostname === 'shopee.com.br')) {
      expect(new URL(link).searchParams.get('keyword')).toBe(term);
    }
    const americanas = links.find(raw => new URL(raw).hostname === 'www.americanas.com.br');
    expect(new URL(americanas).searchParams.get('q')).toBe(term);
  }
});

test('API HTTP aceita somente links externos', async ({ request }) => {
  const response = await request.post('/api/collect', { data: { term: 'fone', searches: [{ marketplace: 'shopee' }], urls: [shopee], min: 170, max: 200, pages: 1, concurrency: 1, excludeInternational: true } });
  expect(response.status()).toBe(200);
  const messages = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  expect(messages.at(-1).data.status).toBe('buscas_prontas');
  expect(messages.at(-1).data.links).toHaveLength(2);
});
