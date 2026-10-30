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
].map(marketplace => ({ ...marketplace, categories: marketplace.categories.map(([id, label]) => ({ id, label })) }));

// Grandes marketplaces brasileiros testados que não entregam anúncios para uma
// requisição de servidor. Ficam visíveis na interface, porém desativados.
export const UNAVAILABLE = [
  { name: 'Mercado Livre', monogram: 'ML', color: '#FFE600', ink: '#2D3277', reason: 'Exige verificação de conta para acessos de servidor.' },
  { name: 'AliExpress', monogram: 'Ali', color: '#FF4747', reason: 'Exige captcha para acessos de servidor.' },
  { name: 'Shopee', monogram: 'S', color: '#EE4D2D', reason: 'Resultados só aparecem via JavaScript.' },
  { name: 'Magalu', monogram: 'M', color: '#0086FF', reason: 'Bloqueia acesso automatizado (HTTP 403).' },
  { name: 'Casas Bahia', monogram: 'CB', color: '#1A3DAF', reason: 'Bloqueia acesso automatizado (HTTP 403).' },
  { name: 'Americanas', monogram: 'a.', color: '#E60014', reason: 'Resultados só aparecem via JavaScript.' },
];

export const MARKETPLACE_BY_ID = new Map(MARKETPLACES.map(marketplace => [marketplace.id, marketplace]));

const BY_HOST = new Map(MARKETPLACES.flatMap(marketplace => marketplace.hosts.map(host => [host, marketplace])));

export function marketplaceForHost(hostname) {
  return BY_HOST.get(hostname) || null;
}

// Monta a URL de busca inicial. O filtro de preço é aplicado depois, no servidor,
// para valer também nas URLs coladas manualmente.
export function buildSearchUrl(marketplaceId, term, categoryId) {
  const marketplace = MARKETPLACE_BY_ID.get(marketplaceId);
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
  return `https://www.kabum.com.br/busca/${slug}`;
}
