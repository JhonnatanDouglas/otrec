import * as cheerio from 'cheerio';

const OPERATION = 'ClientManyProductsQueryWithSearchId';
const PAGE_SIZE = 12;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

export function americanasInitialData(html) {
  const raw = cheerio.load(html)('#__NEXT_DATA__').text();
  if (!raw) return null;
  return JSON.parse(raw)?.props?.pageProps?.data;
}

export function americanasAppScript(html, rawUrl) {
  const $ = cheerio.load(html);
  const path = $('script[src]').toArray().map(script => $(script).attr('src'))
    .find(src => /^\/_next\/static\/chunks\/pages\/_app-[\w-]+\.js$/.test(src));
  if (!path) throw new Error('A Americanas alterou os arquivos da busca. Use o link direto enquanto a integração é atualizada.');
  return new URL(path, rawUrl).href;
}

// Lê apenas os metadados da consulta publicada pelo próprio site; nunca executa
// código remoto. O hash é descoberto a cada coleta, não fixado nesta aplicação.
export function americanasOperationHash(script) {
  const match = script.match(/operationName:\s*["']ClientManyProductsQueryWithSearchId["']\s*,\s*operationHash:\s*["']([a-f0-9]{40,64})["']/);
  if (!match) throw new Error('Não foi possível identificar a consulta de produtos da Americanas. Use o link direto.');
  return match[1];
}

export function americanasApiUrl(rawUrl, hash, config) {
  const source = new URL(rawUrl);
  const page = Math.max(0, Number(source.searchParams.get('page')) || 0);
  const term = source.searchParams.get('q') || '';
  if (!term) throw new Error('Esta busca da Americanas não trouxe dados no HTML. Use uma URL /s?q=produto ou abra a categoria no site.');
  const selectedFacets = [
    { key: 'fuzzy', value: '0' }, { key: 'operator', value: 'and' },
    { key: 'channel', value: JSON.stringify({ salesChannel: 1, regionId: '' }) },
    { key: 'locale', value: 'pt-BR' },
    { key: 'price', value: `${config.min}-to-${config.max}` },
  ];
  const url = new URL('/api/graphql', source.origin);
  url.searchParams.set('operationName', OPERATION);
  url.searchParams.set('operationHash', hash);
  url.searchParams.set('variables', JSON.stringify({ first: PAGE_SIZE, after: String(page * PAGE_SIZE), sort: 'score_desc', term, selectedFacets, sponsoredCount: 3, _postalCode: '' }));
  return url.href;
}

export function extractAmericanas(source, rawUrl, page) {
  const json = source.trim().startsWith('{') ? JSON.parse(source) : americanasInitialData(source);
  if (json?.errors?.length) throw new Error('A Americanas recusou a consulta de produtos. Use o link direto.');
  const data = json?.data ?? json;
  const connection = data?.search?.products;
  if (!Array.isArray(connection?.edges)) throw new Error('A Americanas não retornou os dados dos produtos. Use o link direto.');
  const products = connection.edges.flatMap(({ node: item }, index) => {
    const id = String(item?.sku || item?.id || '');
    if (!id || !item?.name) return [];
    const offers = (item.offers?.offers || []).filter(offer => /\/InStock$/.test(offer.availability || '') && positive(offer.price) && Number(offer.quantity) > 0);
    const offer = offers.reduce((best, current) => !best || current.price < best.price ? current : best, null);
    const preco = positive(offer?.price);
    const original = positive(offer?.listPrice);
    const sellerId = offer?.seller?.identifier;
    const seller = item.sellers?.find(s => s.sellerId === sellerId);
    const url = new URL(item.link || `/${item.slug}/p`, rawUrl);
    if (!['www.americanas.com.br', 'americanas.com.br'].includes(url.hostname) || url.protocol !== 'https:') return [];
    return [{
      id, nome: String(item.name).trim(), preco,
      precoOriginal: original && preco && original > preco ? original : null,
      avaliacao: positive(item.aggregateRating?.ratingValue),
      quantidadeAvaliacoes: positive(item.aggregateRating?.reviewCount),
      imagem: item.image?.[0]?.url || null, link: url.href,
      pagina: page, posicao: index + 1,
      internacional: /compra\s+internacional|envio\s+internacional|enviado\s+do\s+exterior/i.test(`${item.name} ${JSON.stringify(item.properties || [])}`),
      vendedor: seller?.sellerName || null, categoria: item.categories?.[0] || null,
    }];
  });
  const url = new URL(rawUrl);
  const current = Math.max(0, Number(url.searchParams.get('page')) || 0);
  const consumed = current * PAGE_SIZE + connection.edges.length;
  let nextUrl = null;
  if (connection.edges.length && consumed < Number(connection.pageInfo?.totalCount)) {
    url.searchParams.set('page', String(current + 1));
    nextUrl = url.href;
  }
  return { products, nextUrl };
}
