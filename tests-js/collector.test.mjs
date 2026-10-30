import test from 'node:test';
import assert from 'node:assert/strict';
import { collectProducts, configuration, extract, parsePrice, validateUrl, withPriceFilter } from '../lib/collector.js';
import { buildMarketplaceUrl, buildSearchUrl, slugify } from '../lib/marketplaces.js';

const card = (asin, value, extra = '') => `<div data-component-type="s-search-result" data-asin="${asin}"><h2>Fone ${asin}</h2><span class="a-price"><span class="a-offscreen">R$ ${value}</span></span>${extra}</div>`;
const kabumPage = (items, pagination = { current: 1, next: 2, total: 3 }) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data: JSON.stringify({ catalogServer: { data: items, pagination } }) } } })}</script></html>`;
const kabumItem = (code, price, category = 'Hardware/SSD', extra = {}) => ({ code, name: `SSD ${code}`, friendlyName: `ssd-${code}`, price: price * 1.1, oldPrice: price * 1.2, priceWithDiscount: price, available: true, averageRating: 4.5, ratingCount: 10, thumbnail: `https://images.kabum.com.br/${code}.jpg`, category, sellerName: 'KaBuM!', ...extra });
const aliItem = (id, price, origin = 'BR') => ({
  productId: String(id), title: { displayTitle: `Fone Ali ${id}` }, image: { imgUrl: `//example.test/${id}.jpg` },
  prices: { salePrice: { minPrice: price } }, evaluation: { starRating: 4.8 }, trade: { tradeDesc: '2K+ vendido(s)' },
  trace: { pdpParams: { pdp_cdi: encodeURIComponent(JSON.stringify({ shipFrom: origin })) }, utLogMap: { salePriceAmount: String(price * 100), originPriceAmount: String(price * 120) } },
});
const aliPage = (items, pagination = { hasNext: true, current: 1, total: 2 }) => `<html><script>/*init-data-start*/ window._dida_config_={}; window._dida_config_._init_data_= { data: ${JSON.stringify({ data: { root: { fields: { mods: { itemList: { content: items } } } } }, global: { screenPagination: pagination } })} }; /*init-data-end*/</script></html>`;
const json = (data, url, init = {}) => new Response(data, { headers: { 'Content-Type': 'text/html; charset=utf-8', ...init.headers }, status: init.status ?? 200 });

test('converte preços brasileiros', () => { assert.equal(parsePrice('R$ 1.234,56'), 1234.56); assert.equal(parsePrice(''), null); assert.equal(parsePrice('indisponível'), null); });

test('restringe URLs aos marketplaces suportados', () => {
  for (const url of ['http://www.amazon.com.br', 'https://localhost/', 'https://www.amazon.com.br.evil.test', 'https://user@www.amazon.com.br', 'https://www.magazineluiza.com.br/busca/x', 'https://lista.mercadolivre.com.br/x']) assert.throws(() => validateUrl(url));
  assert.equal(validateUrl('https://www.amazon.com.br/s?k=x#foo'), 'https://www.amazon.com.br/s?k=x');
  assert.equal(validateUrl('https://www.kabum.com.br/busca/ssd'), 'https://www.kabum.com.br/busca/ssd');
  assert.equal(validateUrl('https://pt.aliexpress.com/w/wholesale-fone.html'), 'https://pt.aliexpress.com/w/wholesale-fone.html');
});

test('monta buscas por marketplace e categoria', () => {
  assert.equal(slugify('Fone Bluetooth Ação!'), 'fone-bluetooth-acao');
  assert.equal(buildSearchUrl('amazon', 'fone bluetooth', 'electronics'), 'https://www.amazon.com.br/s?k=fone+bluetooth&i=electronics');
  assert.equal(buildSearchUrl('kabum', 'SSD 1TB'), 'https://www.kabum.com.br/busca/ssd-1tb');
  assert.match(buildSearchUrl('aliexpress', 'fone bluetooth', null, { excludeInternational: true }), /SearchText=fone\+bluetooth.*shipfrom.*4StarRating/);
  assert.throws(() => buildSearchUrl('amazon', 'fone', 'inexistente'));
  assert.throws(() => buildSearchUrl('amazon', '   '));
});

test('monta links externos com termo e faixa de preço', () => {
  const options = { min: 150, max: 200, excludeInternational: true };
  const shopee = new URL(buildMarketplaceUrl('shopee', 'fone de ouvido', options));
  assert.equal(shopee.searchParams.get('keyword'), 'fone de ouvido');
  assert.deepEqual(JSON.parse(shopee.searchParams.get('fe_filter_options')).map(filter => filter.group_name), ['FAST_DELIVERY', 'PRICE_RANGE']);
  assert.match(buildMarketplaceUrl('mercadolivre', 'fone de ouvido', options), /fone-de-ouvido.*PriceRange_150BRL-200BRL.*SHIPPING\*ORIGIN/);
  const aliexpress = new URL(buildMarketplaceUrl('aliexpress', 'fone de ouvido', options));
  assert.equal(aliexpress.searchParams.get('SearchText'), 'fone de ouvido');
  assert.match(aliexpress.searchParams.get('selectedSwitches'), /shipfrom/);
  assert.match(aliexpress.searchParams.get('selectedSwitches'), /4StarRating/);
  const magalu = new URL(buildMarketplaceUrl('magalu', 'fone de ouvido', options));
  assert.equal(magalu.searchParams.get('filters'), 'price---15000:20000');
  const casasBahia = new URL(buildMarketplaceUrl('casasbahia', 'fone de ouvido', options));
  assert.deepEqual(casasBahia.searchParams.getAll('filter'), ['preco-150to200']);
  assert.equal(casasBahia.searchParams.has('Parceiro'), false);
  const americanas = new URL(buildMarketplaceUrl('americanas', 'fone de ouvido', options));
  assert.equal(americanas.pathname, '/s');
  assert.equal(americanas.searchParams.get('q'), 'fone de ouvido');
  assert.equal(americanas.searchParams.get('price'), '150-to-200');
});

test('aplica faixa de preço na URL de cada marketplace', () => {
  const range = { min: 170, max: 200.5 };
  assert.match(withPriceFilter('https://www.amazon.com.br/s?k=x&rh=p_36%3A1-2', range), /rh=p_36%3A17000-20050$/);
  assert.equal(withPriceFilter('https://www.kabum.com.br/busca/ssd', range), 'https://www.kabum.com.br/busca/ssd');
  const kabum = new URL(withPriceFilter('https://www.kabum.com.br/hardware/ssd?search-term=ssd', range));
  assert.deepEqual(JSON.parse(Buffer.from(kabum.searchParams.get('facet_filters'), 'base64').toString()), { price: { min: 170, max: 251 } });
  assert.equal(withPriceFilter('https://pt.aliexpress.com/w/wholesale-ssd.html?SearchText=ssd', range), 'https://pt.aliexpress.com/w/wholesale-ssd.html?SearchText=ssd');
});

test('extrai cartões e paginação da Amazon', () => {
  const source = card('A', '180,50', '<span class="a-price a-text-price"><span class="a-offscreen">R$ 220,00</span></span>') + card('B', '185,00', '<img src="11tVhj88LYL.jpg">') + '<a class="s-pagination-next" href="/s?page=2">Próximo</a>';
  const result = extract(source, 'https://www.amazon.com.br/s?k=x', 1);
  assert.deepEqual(result.products.map(product => product.id), ['A', 'B']);
  assert.equal(result.products[0].preco, 180.5);
  assert.equal(result.products[0].precoOriginal, 220);
  assert.equal(result.products[0].marketplaceId, 'amazon');
  assert.equal(result.products[1].internacional, true);
  assert.equal(result.nextUrl, 'https://www.amazon.com.br/s?page=2');
});

test('extrai produtos e paginação do KaBuM! a partir do JSON do Next.js', () => {
  const item = kabumItem(42, 180, 'Hardware/SSD', { offer: { priceWithDiscount: 175 } });
  const { products, nextUrl } = extract(kabumPage([item, kabumItem(43, 190, 'Hardware/SSD', { available: false })]), 'https://www.kabum.com.br/hardware/ssd?search-term=ssd', 1);
  assert.equal(products[0].preco, 175);
  assert.equal(products[0].link, 'https://www.kabum.com.br/produto/42/ssd-42');
  assert.equal(products[0].avaliacao, 4.5);
  assert.equal(products[1].preco, null);
  assert.equal(nextUrl, 'https://www.kabum.com.br/hardware/ssd?search-term=ssd&page_number=2');
  assert.equal(extract(kabumPage([item], { current: 3, next: 0, total: 3 }), 'https://www.kabum.com.br/x', 3).nextUrl, null);
});

test('extrai produtos e paginação do JSON do AliExpress', () => {
  const { products, nextUrl } = extract(aliPage([aliItem(123, 180), aliItem(456, 190, 'CN')]), 'https://pt.aliexpress.com/w/wholesale-fone.html?SearchText=fone', 1);
  assert.deepEqual(products.map(product => product.id), ['123', '456']);
  assert.equal(products[0].preco, 180);
  assert.equal(products[0].precoOriginal, 216);
  assert.equal(products[0].avaliacao, 4.8);
  assert.equal(products[0].vendidos, 2000);
  assert.equal(products[0].internacional, false);
  assert.equal(products[1].internacional, true);
  assert.equal(products[0].marketplaceId, 'aliexpress');
  assert.equal(nextUrl, 'https://pt.aliexpress.com/w/wholesale-fone.html?SearchText=fone&page=2');
});

test('recusa URLs próprias que não são de busca/listagem', () => {
  const base = { min: 170, max: 200, pages: 1, concurrency: 1, excludeInternational: true };
  for (const url of ['https://www.amazon.com.br/dp/B0C3HCD34R', 'https://www.amazon.com.br/gp/bestsellers/electronics', 'https://www.kabum.com.br/produto/42/ssd', 'https://www.kabum.com.br/', 'https://pt.aliexpress.com/item/123.html']) {
    assert.throws(() => configuration({ ...base, urls: [url] }), /página de busca/);
  }
  for (const url of ['https://www.amazon.com.br/s?k=x&crid=1&ref=nb_sb_noss', 'https://www.amazon.com.br/b?node=1', 'https://www.kabum.com.br/hardware/ssd', 'https://pt.aliexpress.com/w/wholesale-fone.html?SearchText=fone']) {
    assert.equal(configuration({ ...base, urls: [url] }).jobs.length, 1);
  }
});

test('reconhece o desafio antirrobô do Akamai', () => {
  const page = '<html><head><title>&nbsp;</title></head><body><script>xhr.open("POST", "/_sec/verify?provider=interstitial")</script></body></html>';
  assert.throws(() => extract(page, 'https://www.amazon.com.br/s?k=x', 1), /antirrobô/);
});

test('valida limites adequados à Vercel', () => {
  const base = { min: 170, max: 200, pages: 20, concurrency: 2, excludeInternational: true };
  assert.equal(configuration({ ...base, urls: ['https://www.amazon.com.br/s'] }).pages, 20);
  assert.throws(() => configuration({ ...base, urls: ['https://www.amazon.com.br/s'], pages: 101 }));
  assert.throws(() => configuration({ ...base, searches: [{ marketplace: 'amazon' }], term: '' }));
  for (const marketplace of ['shopee', 'mercadolivre']) {
    const external = configuration({ ...base, searches: [{ marketplace }], term: 'x' });
    assert.equal(external.jobs.length, 0);
    assert.equal(external.links[0].marketplaceId, marketplace);
  }
  assert.equal(configuration({ ...base, searches: [{ marketplace: 'aliexpress' }], term: 'fone' }).jobs[0].marketplace, 'aliexpress');
  assert.throws(() => configuration({ ...base }));
  const config = configuration({ ...base, term: 'ssd', searches: [{ marketplace: 'kabum', category: 'hardware' }, { marketplace: 'amazon' }], urls: ['https://www.kabum.com.br/hardware'] });
  assert.deepEqual(config.jobs.map(job => [job.marketplace, job.category, job.custom]), [['kabum', 'Hardware', false], ['amazon', null, false], ['kabum', null, true]]);
});

test('coleta, filtra e conclui em uma invocação serverless', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => json(card('A', '180,00') + card('B', '210,00'));
  const config = configuration({ urls: ['https://www.amazon.com.br/s?k=x'], min: 170, max: 200, pages: 1, concurrency: 1, excludeInternational: true });
  const updates = [];
  const result = await collectProducts(config, { onUpdate: value => updates.push(value) });
  assert.equal(result.status, 'concluido');
  assert.deepEqual(result.produtos.map(product => product.id), ['A']);
  assert.equal(result.descartadosPreco, 1);
  assert.equal(result.fontes[0].status, 'concluido');
  assert.equal(result.fontes[0].aceitos, 1);
  assert.ok(updates.length >= 3);
});

test('segue o redirecionamento da busca do KaBuM! e filtra por departamento', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const requested = [];
  global.fetch = async url => {
    requested.push(url);
    if (url.endsWith('/busca/ssd')) return new Response(null, { status: 301, headers: { Location: '/hardware/ssd?search-term=ssd' } });
    return json(kabumPage([kabumItem(1, 180), kabumItem(2, 185, 'Periféricos/Mouse'), kabumItem(3, 500)], { current: 1, next: 0, total: 1 }));
  };
  const config = configuration({ term: 'ssd', searches: [{ marketplace: 'kabum', category: 'hardware' }], min: 170, max: 200, pages: 2, concurrency: 1, excludeInternational: true });
  const result = await collectProducts(config);
  // A busca redireciona e descarta parâmetros: a faixa de preço é reaplicada no destino do redirecionamento.
  assert.equal(requested.length, 2);
  assert.equal(requested[0], 'https://www.kabum.com.br/busca/ssd');
  assert.match(requested[1], /^https:\/\/www\.kabum\.com\.br\/hardware\/ssd\?search-term=ssd&facet_filters=/);
  assert.deepEqual(result.produtos.map(product => product.id), ['1']);
  assert.equal(result.descartadosCategoria, 1);
  assert.equal(result.descartadosPreco, 1);
});

test('informa verificação humana exigida pelo marketplace', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async () => new Response(null, { status: 302, headers: { Location: 'https://www.amazon.com.br/errors/validateCaptcha?x=1' } });
  const config = configuration({ term: 'fone', searches: [{ marketplace: 'amazon' }], min: 170, max: 200, pages: 1, concurrency: 1, excludeInternational: true });
  const result = await collectProducts(config);
  assert.equal(result.status, 'concluido_com_avisos');
  assert.match(result.fontes[0].erro, /verificação/);
});
