import test from 'node:test';
import assert from 'node:assert/strict';
import { americanasAppScript, americanasOperationHash, extractAmericanas } from '../lib/americanas.js';
import { configuration, collectProducts } from '../lib/collector.js';
import { summarizeMarkets } from '../lib/search-results.js';
import { MARKETPLACES } from '../lib/marketplaces.js';

const product = (id, price = 185) => ({ sku: String(id), name: `Fone Americanas ${id}`, link: `/fone-${id}/p`, image: [{ url: 'https://example.test/fone.jpg' }],
  offers: { offers: [{ availability: 'https://schema.org/InStock', price, listPrice: 220, quantity: 10, seller: { identifier: '1' } }] },
  sellers: [{ sellerId: '1', sellerName: 'AMERICANAS SA' }],
});
const connection = (items, totalCount = items.length) => ({ search: { products: { edges: items.map(node => ({ node })), pageInfo: { totalCount } } } });

test('Americanas usa menor oferta disponível, preserva vendedor e paginação', () => {
  const item = product(42);
  item.offers.offers.unshift({ availability: 'https://schema.org/OutOfStock', price: 150, quantity: 0 });
  const result = extractAmericanas(JSON.stringify({ data: connection([item], 13) }), 'https://www.americanas.com.br/s?q=fone&page=0', 1);
  assert.equal(result.products[0].preco, 185);
  assert.equal(result.products[0].precoOriginal, 220);
  assert.equal(result.products[0].vendedor, 'AMERICANAS SA');
  assert.equal(result.products[0].link, 'https://www.americanas.com.br/fone-42/p');
  assert.equal(new URL(result.nextUrl).searchParams.get('page'), '1');
  const unavailable = product(43);
  unavailable.offers.offers[0].quantity = 0;
  assert.equal(extractAmericanas(JSON.stringify({ data: connection([unavailable]) }), 'https://www.americanas.com.br/s?q=fone', 1).products[0].preco, null);
});

test('descoberta de consulta não aceita scripts externos ou código executável', () => {
  assert.throws(() => americanasAppScript('<script src="https://evil.test/_app-x.js"></script>', 'https://www.americanas.com.br/s?q=fone'));
  assert.throws(() => americanasOperationHash('globalThis.compromised = true'));
  assert.throws(() => extractAmericanas('{"errors":[{"message":"Changed query"}]}', 'https://www.americanas.com.br/s?q=fone', 1), /recusou/);
});

test('Americanas descobre hash atual e coleta duas páginas com filtros reais', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const requested = [];
  global.fetch = async raw => {
    const url = new URL(raw);
    requested.push(url);
    if (url.pathname === '/s') return new Response('<script src="/_next/static/chunks/pages/_app-current.js"></script>', { headers: { 'Content-Type': 'text/html' } });
    if (url.pathname.includes('_app-current')) return new Response(`const meta={operationName:"ClientManyProductsQueryWithSearchId",operationHash:"${'a'.repeat(40)}"};`, { headers: { 'Content-Type': 'text/javascript' } });
    assert.equal(url.pathname, '/api/graphql');
    assert.equal(url.searchParams.get('operationHash'), 'a'.repeat(40));
    const vars = JSON.parse(url.searchParams.get('variables'));
    assert.equal(vars.term, 'fone');
    assert.deepEqual(vars.selectedFacets.find(facet => facet.key === 'price'), { key: 'price', value: '170-to-200' });
    const items = vars.after === '0' ? Array.from({ length: 12 }, (_, index) => product(index)) : [product(12)];
    return new Response(JSON.stringify({ data: connection(items, 13) }), { headers: { 'Content-Type': 'application/json' } });
  };
  const config = configuration({ term: 'fone', searches: [{ marketplace: 'americanas' }], min: 170, max: 200, pages: 2, concurrency: 1, excludeInternational: true });
  const result = await collectProducts(config);
  assert.equal(result.status, 'concluido');
  assert.equal(result.produtos.length, 13);
  assert.equal(result.paginasColetadas, 2);
  assert.equal(requested.length, 4);
  assert.equal(JSON.parse(requested.at(-1).searchParams.get('variables')).after, '12');
});

test('lojas sem produtos continuam nos filtros com a razão da ausência', () => {
  const snapshot = { links: MARKETPLACES.map(m => ({ marketplaceId: m.id, url: `https://example.test/${m.id}` })), produtos: [], fontes: [
    { marketplaceId: 'aliexpress', status: 'concluido', anuncios: 56, aceitos: 0, descartadosInternacionais: 50, descartadosOrigemDesconhecida: 5, descartadosPreco: 1 },
  ] };
  const markets = summarizeMarkets(snapshot);
  assert.equal(markets.length, 8);
  const ali = markets.find(m => m.marketplace.id === 'aliexpress');
  assert.equal(ali.count, 0);
  assert.match(ali.message, /50 internacionais/);
  assert.match(ali.message, /5 sem origem confirmada/);
  assert.match(markets.find(m => m.marketplace.id === 'shopee').message, /não tem coleta integrada/);
});
