import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETPLACES, slugify } from '../lib/marketplaces.js';
import { buildSearchPlan } from '../lib/search-plan.js';

const examples = ['fone de ouvido', 'controle de video game', 'drone', 'mochila', 'poco x7 pro'];
const templates = [
  'https://www.amazon.com.br/s?k=fone+de+ouvido&rh=p_36%3A15000-20000',
  'https://www.kabum.com.br/busca/fone-de-ouvido?facet_filters=abc',
  'https://lista.mercadolivre.com.br/fone-de-ouvido_CustoFrete_Gratis_Frete_Full_PriceRange_150BRL-200BRL_NoIndex_True_SHIPPING*ORIGIN_10215069',
  'https://shopee.com.br/search?fe_filter_options=%5B%7B%22group_name%22%3A%22RATING%22%2C%22values%22%3A%5B%224%22%5D%7D%5D&keyword=fone%20de%20ouvido&page=0',
  'https://pt.aliexpress.com/w/wholesale-fone-de-ouvido.html?g=y&SearchText=fone+de+ouvido&selectedSwitches=filterCode%3Afreeshipping%2CfilterCode%3Ashipfrom%2CfilterCode%3A4StarRating&shpf_co=BR',
  'https://www.magazineluiza.com.br/busca/fone+de+ouvido/?page=1&sortOrientation=desc&sortType=score&filters=price---10000%3A20000%2Breview---5',
  'https://www.casasbahia.com.br/fone-de-ouvido/b?filter=preco-150to200&filter=avaliacao-r4&Parceiro=Google&Midia=BuscaOrganica&Campanha=DescontoEspecial',
  'https://www.americanas.com.br/audio-e-video/fone-de-ouvido?category-1=audio-e-video&category-2=Fone-de-ouvido&fuzzy=0&operator=and&price=100-to-250&facets=category-1%2Ccategory-2%2Cfuzzy%2Coperator%2Cprice&sort=score_desc&page=0',
];

function assertTerm(link, term) {
  const url = new URL(link.url);
  const slug = slugify(term);
  switch (link.marketplaceId) {
    case 'amazon': assert.equal(url.searchParams.get('k'), term); break;
    case 'shopee': assert.equal(url.searchParams.get('keyword'), term); break;
    case 'aliexpress':
      assert.equal(url.searchParams.get('SearchText'), term);
      assert.equal(url.pathname, `/w/wholesale-${slug}.html`);
      break;
    case 'americanas': assert.equal(url.searchParams.get('q'), term); assert.equal(url.pathname, '/s'); break;
    case 'kabum': assert.equal(url.pathname, `/busca/${slug}`); break;
    case 'mercadolivre': assert.equal(url.pathname.split('_')[0], `/${slug}`); break;
    case 'magalu': assert.equal(decodeURIComponent(url.pathname.split('/')[2].replaceAll('+', ' ')), term); break;
    case 'casasbahia': assert.equal(url.pathname, `/${slug}/b`); break;
    default: assert.fail('Loja não verificada');
  }
}

for (const term of examples) {
  test(`nome correto nas oito lojas e nos oito modelos extras: ${term}`, () => {
    const selected = buildSearchPlan({ term, searches: MARKETPLACES.map(m => ({ marketplace: m.id })), min: 100, max: 200 });
    assert.equal(selected.links.length, 8);
    for (const link of selected.links) assertTerm(link, term);
    const custom = buildSearchPlan({ term, urls: templates, min: 100, max: 200 });
    assert.equal(custom.links.length, 8);
    for (const link of custom.links) assertTerm(link, term);
    const amer = new URL(custom.links.find(link => link.marketplaceId === 'americanas').url);
    assert.equal(amer.searchParams.has('category-1'), false);
    assert.equal(amer.searchParams.get('facets'), 'fuzzy,operator,price');
    const casas = new URL(custom.links.find(link => link.marketplaceId === 'casasbahia').url);
    assert.deepEqual(casas.searchParams.getAll('filter'), ['preco-150to200', 'avaliacao-r4']);
    const shopee = new URL(custom.links.find(link => link.marketplaceId === 'shopee').url);
    assert.deepEqual(JSON.parse(shopee.searchParams.get('fe_filter_options')), [{ group_name: 'RATING', values: ['4'] }]);
  });
}

test('a URL personalizada sempre acompanha o nome digitado e preserva o original sem termo', () => {
  const input = { term: 'mochila', urls: [templates[3]], min: 100, max: 200 };
  assertTerm(buildSearchPlan({ ...input, followTerm: false }).links[0], 'mochila');
  assertTerm(buildSearchPlan({ ...input, term: '' }).links[0], 'fone de ouvido');
});

test('caracteres especiais não quebram o termo ou injetam parâmetros', () => {
  const term = 'controle Xbox + PS5 / edição #1 & 2';
  const plan = buildSearchPlan({ term, searches: MARKETPLACES.map(m => ({ marketplace: m.id })), min: 100, max: 200 });
  for (const link of plan.links) assertTerm(link, term);
});
