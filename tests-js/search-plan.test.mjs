import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETPLACES } from '../lib/marketplaces.js';
import { buildSearchPlan } from '../lib/search-plan.js';
import { configuration, collectProducts } from '../lib/collector.js';
import { POST } from '../app/api/collect/route.js';

const input = { term: 'fone', searches: MARKETPLACES.map(m => ({ marketplace: m.id })), min: 170, max: 200, pages: 1, concurrency: 3, excludeInternational: true };
const shopee = 'https://shopee.com.br/search?keyword=fone&fe_filter_options=%5B%5D&page=0';

test('os oito sites e uma URL externa não cancelam os coletores', () => {
  const config = configuration({ ...input, urls: [shopee] });
  assert.deepEqual(config.jobs.map(job => job.marketplace), ['amazon', 'kabum', 'aliexpress', 'americanas']);
  assert.equal(config.links.length, 9);
  assert.equal(config.warnings.length, 0);
  assert.equal(config.links.at(-1).url, shopee);
});

test('uma URL inválida não bloqueia as fontes válidas ou links externos', () => {
  for (const url of ['http://localhost:3000/', 'https://amazon.com.br.evil.test/s', 'isto não é uma URL', 'https://user:secret@www.amazon.com.br/s']) {
    const plan = buildSearchPlan({ ...input, urls: [url, shopee] });
    assert.equal(plan.jobs.length, 4);
    assert.equal(plan.links.length, 9);
    assert.equal(plan.warnings.length, 1);
    assert.equal(plan.links.some(link => link.url === url), false);
  }
});

test('links personalizados preservam todos os filtros e não são enviados ao coletor', async () => {
  const originalFetch = global.fetch;
  let requests = 0;
  global.fetch = () => { requests += 1; throw new Error('não deve buscar links externos'); };
  try {
    const config = configuration({ ...input, searches: [], urls: [shopee] });
    const result = await collectProducts(config);
    assert.equal(requests, 0);
    assert.equal(result.status, 'buscas_prontas');
    assert.equal(result.links[0].url, shopee);
  } finally { global.fetch = originalFetch; }
});

test('URL inválida sozinha é recusada e limite de URLs é validado', () => {
  assert.throws(() => configuration({ ...input, searches: [], urls: ['https://localhost/s'] }), /oito marketplaces/);
  assert.throws(() => configuration({ ...input, urls: Array(9).fill(shopee) }), /até 8/);
});

test('API aceita seleção mista e URL externa, sem fazer fetch dessa URL', async () => {
  const originalFetch = global.fetch;
  const requested = [];
  global.fetch = async url => {
    requested.push(url);
    return new Response('<div data-component-type="s-search-result" data-asin="TEST"><h2>Fone teste</h2><span class="a-price"><span class="a-offscreen">R$ 180,00</span></span></div>', { headers: { 'Content-Type': 'text/html' } });
  };
  try {
    const response = await POST(new Request('http://localhost/api/collect', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-App-Token': process.env.APP_TOKEN || '' },
      body: JSON.stringify({ ...input, searches: [{ marketplace: 'amazon' }, { marketplace: 'shopee' }], urls: [shopee, 'https://localhost/'] }),
    }));
    assert.equal(response.status, 200);
    const updates = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    const result = updates.at(-1).data;
    assert.equal(result.produtos[0].nome, 'Fone teste');
    assert.equal(result.avisos.length, 1);
    assert.equal(result.links.length, 3);
    assert.equal(requested.length, 1);
    assert.equal(new URL(requested[0]).hostname, 'www.amazon.com.br');
  } finally { global.fetch = originalFetch; }
});
