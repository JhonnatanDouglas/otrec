// Catálogo de marketplaces compartilhado entre a interface e a função serverless.
// Categorias da Amazon vêm do seletor "search-alias" do próprio site; as do Kabum
// são os departamentos verificados em /<slug>.

export function slugify(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

export const MARKETPLACES = [
  {
    id: 'amazon',
    name: 'Amazon',
    collect: true,
    monogram: 'a',
    color: '#FF9900',
    ink: '#131921',
    hosts: ['www.amazon.com.br', 'amazon.com.br'],
    priceFilter: 'na URL',
    blurb: 'Detecta o selo de compra internacional.',
    categories: [
      ['electronics', 'Eletrônicos'],
      ['computers', 'Computadores e Informática'],
      ['videogames', 'Games'],
      ['amazon-devices', 'Dispositivos Amazon'],
      ['appliances', 'Eletrodomésticos'],
      ['kitchen', 'Cozinha'],
      ['home', 'Casa'],
      ['furniture', 'Móveis e Decoração'],
      ['hi', 'Ferramentas e Construção'],
      ['garden', 'Jardim e Piscina'],
      ['beauty', 'Beleza'],
      ['hpc', 'Saúde e Cuidados Pessoais'],
      ['fashion', 'Roupas, Calçados e Joias'],
      ['fashion-luggage', 'Bolsas, Malas e Mochilas'],
      ['sporting', 'Esportes e Aventura'],
      ['toys', 'Brinquedos e Jogos'],
      ['baby', 'Bebês'],
      ['pets', 'Pet Shop'],
      ['automotive', 'Automotivo'],
      ['office-products', 'Escritório e Papelaria'],
      ['mi', 'Instrumentos Musicais'],
      ['stripbooks', 'Livros'],
      ['grocery', 'Alimentos e Bebidas'],
    ],
  },
  {
    id: 'kabum',
    name: 'KaBuM!',
    collect: true,
    monogram: 'K!',
    color: '#FF6500',
    ink: '#111111',
    hosts: ['www.kabum.com.br', 'kabum.com.br'],
    priceFilter: 'na URL',
    blurb: 'Tecnologia e games, com preço à vista.',
    categories: [
      ['hardware', 'Hardware'],
      ['perifericos', 'Periféricos'],
      ['computadores', 'Computadores'],
      ['celular-smartphone', 'Celular & Smartphone'],
      ['espaco-gamer', 'Espaço Gamer'],
      ['tv', 'TV'],
      ['audio', 'Áudio'],
      ['cameras-e-drones', 'Câmeras e Drones'],
      ['casa-inteligente', 'Casa Inteligente'],
      ['eletrodomesticos', 'Eletrodomésticos'],
      ['eletroportateis', 'Eletroportáteis'],
      ['ar-e-ventilacao', 'Ar e Ventilação'],
      ['energia', 'Energia'],
      ['escritorio', 'Escritório'],
      ['seguranca', 'Segurança'],
    ],
  },
  {
    id: 'mercadolivre', name: 'Mercado Livre', monogram: 'ML', color: '#FFE600', ink: '#2D3277', collect: false,
    searchHosts: ['lista.mercadolivre.com.br', 'www.mercadolivre.com.br', 'mercadolivre.com.br'],
    priceFilter: 'na URL', blurb: 'Abre a busca pronta com preço e entrega.', categories: [],
  },
  {
    id: 'shopee', name: 'Shopee', monogram: 'S', color: '#EE4D2D', ink: '#FFFFFF', collect: false,
    searchHosts: ['shopee.com.br', 'www.shopee.com.br'],
    priceFilter: 'na URL', blurb: 'Abre a busca pronta com preço e entrega rápida.', categories: [],
  },
  {
    id: 'aliexpress', name: 'AliExpress', monogram: 'Ali', color: '#FF4747', ink: '#FFFFFF', collect: true,
    hosts: ['pt.aliexpress.com'], priceFilter: 'local', blurb: 'Coleta preço em BRL, nota, vendidos e origem.', categories: [],
  },
  {
    id: 'magalu', name: 'Magalu', monogram: 'M', color: '#0086FF', ink: '#FFFFFF', collect: false,
    searchHosts: ['www.magazineluiza.com.br', 'magazineluiza.com.br'],
    priceFilter: 'na URL', blurb: 'Abre a busca pronta com faixa de preço.', categories: [],
  },
  {
    id: 'casasbahia', name: 'Casas Bahia', monogram: 'CB', color: '#1A3DAF', ink: '#FFFFFF', collect: false,
    searchHosts: ['www.casasbahia.com.br', 'casasbahia.com.br'],
    priceFilter: 'na URL', blurb: 'Abre a busca pronta com faixa de preço.', categories: [],
  },
  {
    id: 'americanas', name: 'Americanas', monogram: 'a.', color: '#E60014', ink: '#FFFFFF', collect: true,
    hosts: ['www.americanas.com.br', 'americanas.com.br'],
    priceFilter: 'na URL', blurb: 'Coleta ofertas, preço à vista, imagem e vendedor.', categories: [],
  },
].map(marketplace => ({ ...marketplace, categories: marketplace.categories.map(([id, label]) => ({ id, label })) }));

export const MARKETPLACE_BY_ID = new Map(MARKETPLACES.map(marketplace => [marketplace.id, marketplace]));
export const COLLECTABLE_MARKETPLACES = MARKETPLACES.filter(marketplace => marketplace.collect);
export const COLLECTABLE_MARKETPLACE_BY_ID = new Map(COLLECTABLE_MARKETPLACES.map(marketplace => [marketplace.id, marketplace]));

const BY_HOST = new Map(COLLECTABLE_MARKETPLACES.flatMap(marketplace => marketplace.hosts.map(host => [host, marketplace])));

export function marketplaceForHost(hostname) {
  return BY_HOST.get(hostname) || null;
}

function aliExpressSearchUrl(term, excludeInternational = true) {
  const slug = slugify(term);
  const url = new URL(`https://pt.aliexpress.com/w/wholesale-${slug}.html`);
  url.searchParams.set('g', 'y');
  url.searchParams.set('SearchText', String(term).trim());
  const switches = ['filterCode:freeshipping', 'filterCode:4StarRating'];
  if (excludeInternational) switches.splice(1, 0, 'filterCode:shipfrom');
  url.searchParams.set('selectedSwitches', switches.join(','));
  url.searchParams.set('shpf_co', 'BR');
  return url.href;
}

// Monta a URL de busca inicial. O filtro de preço é aplicado depois, no servidor,
// para valer também nas URLs coladas manualmente.
export function buildSearchUrl(marketplaceId, term, categoryId, options = {}) {
  const marketplace = COLLECTABLE_MARKETPLACE_BY_ID.get(marketplaceId);
  if (!marketplace) throw new Error('Marketplace desconhecido.');
  const category = categoryId ? marketplace.categories.find(item => item.id === categoryId) : null;
  if (categoryId && !category) throw new Error(`Categoria inválida para ${marketplace.name}.`);
  const slug = slugify(term);
  if (!slug) throw new Error('Digite o que você procura.');
  if (marketplaceId === 'amazon') {
    const url = new URL('https://www.amazon.com.br/s');
    url.searchParams.set('k', String(term).trim());
    if (category) url.searchParams.set('i', category.id);
    return url.href;
  }
  if (marketplaceId === 'aliexpress') return aliExpressSearchUrl(term, options.excludeInternational !== false);
  if (marketplaceId === 'americanas') {
    const url = new URL('https://www.americanas.com.br/s');
    url.searchParams.set('q', String(term).trim());
    return url.href;
  }
  return `https://www.kabum.com.br/busca/${slug}`;
}

// Gera uma busca navegável no site do marketplace. Esses links são o fallback
// para fontes que bloqueiam coleta por servidor e também para falhas ocasionais
// da Amazon/KaBuM!.
export function buildMarketplaceUrl(marketplaceId, term, options = {}) {
  const marketplace = MARKETPLACE_BY_ID.get(marketplaceId);
  if (!marketplace) throw new Error('Marketplace desconhecido.');
  const query = String(term || '').trim();
  const slug = slugify(query);
  if (!slug) throw new Error('Digite o que você procura.');
  const min = Number(options.min);
  const max = Number(options.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || min >= max) throw new Error('Faixa de preço inválida.');
  const lower = Math.floor(min);
  const upper = Math.ceil(max);
  const excludeInternational = options.excludeInternational !== false;

  if (marketplaceId === 'amazon') {
    const url = new URL(buildSearchUrl('amazon', query, options.category || null));
    url.searchParams.set('rh', `p_36:${Math.round(min * 100)}-${Math.round(max * 100)}`);
    return url.href;
  }
  if (marketplaceId === 'kabum') return buildSearchUrl('kabum', query, options.category || null);
  if (marketplaceId === 'mercadolivre') {
    const origin = excludeInternational ? '_SHIPPING*ORIGIN_10215069' : '';
    return `https://lista.mercadolivre.com.br/${slug}_CustoFrete_Gratis_Frete_Full_PriceRange_${lower}BRL-${upper}BRL_NoIndex_True${origin}`;
  }
  if (marketplaceId === 'shopee') {
    const filters = [];
    if (excludeInternational) filters.push({ group_name: 'FAST_DELIVERY', values: ['FAST_DELIVERY', 'channel_91007_stocked_br_product_label_filter'] });
    filters.push({ group_name: 'PRICE_RANGE', values: [`${lower}▶◀${upper + 1}`] });
    const url = new URL('https://shopee.com.br/search');
    url.searchParams.set('fe_filter_options', JSON.stringify(filters));
    url.searchParams.set('keyword', query);
    url.searchParams.set('page', '0');
    return url.href;
  }
  if (marketplaceId === 'aliexpress') {
    return aliExpressSearchUrl(query, excludeInternational);
  }
  if (marketplaceId === 'magalu') {
    const path = encodeURIComponent(query).replaceAll('%20', '+');
    const url = new URL(`https://www.magazineluiza.com.br/busca/${path}/`);
    url.searchParams.set('page', '1');
    url.searchParams.set('sortOrientation', 'desc');
    url.searchParams.set('sortType', 'score');
    url.searchParams.set('filters', `price---${Math.round(min * 100)}:${Math.round(max * 100)}`);
    return url.href;
  }
  if (marketplaceId === 'casasbahia') {
    const url = new URL(`https://www.casasbahia.com.br/${slug}/b`);
    url.searchParams.append('filter', `preco-${lower}to${upper}`);
    return url.href;
  }
  const url = new URL('https://www.americanas.com.br/s');
  url.searchParams.set('q', query);
  url.searchParams.set('price', `${lower}-to-${upper}`);
  url.searchParams.set('facets', 'price');
  url.searchParams.set('sort', 'score_desc');
  url.searchParams.set('page', '0');
  return url.href;
}

// As URLs coladas pelo usuário também podem servir de modelo de filtros.
// Substitui somente o termo e remove categorias fixas incompatíveis com uma
// busca genérica, sem perder filtros de preço, entrega ou avaliação.
export function retargetSearchUrl(rawUrl, marketplaceId, term) {
  const query = String(term || '').trim();
  const slug = slugify(query);
  if (!slug) throw new Error('Digite o que você procura.');
  const url = new URL(rawUrl);
  if (marketplaceId === 'amazon') {
    url.pathname = '/s';
    url.searchParams.set('k', query);
  } else if (marketplaceId === 'kabum') {
    url.pathname = `/busca/${slug}`;
    // A busca redireciona para a categoria correta no próprio KaBuM!.
    url.searchParams.delete('search-term');
    url.searchParams.delete('page_number');
  } else if (marketplaceId === 'mercadolivre') {
    const filterIndex = url.pathname.indexOf('_');
    const filters = filterIndex >= 0 ? url.pathname.slice(filterIndex) : '';
    url.pathname = `/${slug}${filters}`;
  } else if (marketplaceId === 'shopee') {
    url.pathname = '/search';
    url.searchParams.set('keyword', query);
    url.searchParams.set('page', '0');
  } else if (marketplaceId === 'aliexpress') {
    url.pathname = `/w/wholesale-${slug}.html`;
    url.searchParams.set('SearchText', query);
    url.searchParams.delete('page');
  } else if (marketplaceId === 'magalu') {
    url.pathname = `/busca/${encodeURIComponent(query).replaceAll('%20', '+')}/`;
    url.searchParams.set('page', '1');
  } else if (marketplaceId === 'casasbahia') {
    url.pathname = `/${slug}/b`;
    for (const key of ['Parceiro', 'Midia', 'Campanha']) url.searchParams.delete(key);
  } else if (marketplaceId === 'americanas') {
    url.pathname = '/s';
    url.searchParams.set('q', query);
    for (const key of [...url.searchParams.keys()]) if (/^category-\d+$/.test(key)) url.searchParams.delete(key);
    const facets = (url.searchParams.get('facets') || '').split(',').filter(key => key && !/^category-\d+$/.test(key));
    if (facets.length) url.searchParams.set('facets', facets.join(','));
    else url.searchParams.delete('facets');
    url.searchParams.set('page', '0');
  } else throw new Error('Marketplace desconhecido.');
  url.hash = '';
  return url.href;
}
