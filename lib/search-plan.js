import { MARKETPLACES, MARKETPLACE_BY_ID, buildMarketplaceUrl, buildSearchUrl, retargetSearchUrl } from './marketplaces.js';

export const MAX_CUSTOM_URLS = 8;

// Links navegáveis e URLs buscadas pelo servidor têm permissões diferentes.
// Acrescentar um domínio aqui NÃO o autoriza no fetch do coletor.
const SEARCH_BY_HOST = new Map(MARKETPLACES.flatMap(marketplace =>
  [...(marketplace.hosts || []), ...(marketplace.searchHosts || [])].map(host => [host, marketplace])));

export function isMarketplaceListing(url, marketplaceId) {
  const path = url.pathname;
  if (marketplaceId === 'amazon') return /^\/(s|b)(\/|$)/.test(path);
  if (marketplaceId === 'kabum') return path.length > 1 && !path.startsWith('/produto/');
  if (marketplaceId === 'aliexpress') return path.startsWith('/w/wholesale-');
  if (marketplaceId === 'shopee') return path === '/search';
  if (marketplaceId === 'mercadolivre') return url.hostname === 'lista.mercadolivre.com.br' && path.length > 1;
  if (marketplaceId === 'magalu') return path.startsWith('/busca/');
  if (marketplaceId === 'casasbahia') return /\/b\/?$/.test(path);
  if (marketplaceId === 'americanas') return path.length > 1 && !/\/p\/?$/.test(path) && !/^\/(produto|api|_next|account|checkout)(\/|$)/.test(path);
  return false;
}

function parseCustomUrl(raw) {
  let url;
  try { url = new URL(raw.trim()); } catch { throw new Error('Endereço inválido. Cole a URL completa da busca.'); }
  const marketplace = SEARCH_BY_HOST.get(url.hostname);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !marketplace) {
    throw new Error('Use uma URL HTTPS de um dos oito marketplaces listados.');
  }
  if (!isMarketplaceListing(url, marketplace.id)) throw new Error('Cole uma página de busca ou categoria, não uma página de produto.');
  url.hash = '';
  return { url: url.href, marketplace };
}

// Compartilhado entre navegador e API para que URLs extras recebam o mesmo
// tratamento. Uma URL inválida produz um aviso sem cancelar as outras fontes.
export function buildSearchPlan(data) {
  const searches = data.searches ?? [];
  const rawUrls = data.urls ?? [];
  if (!Array.isArray(searches) || searches.length > MARKETPLACES.length || searches.some(item => !item || typeof item !== 'object')) {
    throw new Error('Seleção de marketplaces inválida.');
  }
  if (!Array.isArray(rawUrls) || rawUrls.length > MAX_CUSTOM_URLS || rawUrls.some(url => typeof url !== 'string')) {
    throw new Error(`Informe até ${MAX_CUSTOM_URLS} URLs personalizadas.`);
  }
  const term = typeof data.term === 'string' ? data.term.trim() : '';
  if (searches.length && (!term || term.length > 120)) throw new Error('Digite o que você procura (até 120 caracteres).');
  const min = Number(data.min ?? 170);
  const max = Number(data.max ?? 200);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || min >= max || max > 10_000_000) {
    throw new Error('Informe preços válidos, com máximo maior que mínimo.');
  }

  const jobs = [];
  const links = [];
  const warnings = [];
  const selected = new Set();
  const addLink = (marketplace, url, custom) => {
    if (!links.some(link => link.url === url)) links.push({ marketplaceId: marketplace.id, url, custom });
  };
  for (const search of searches) {
    const marketplace = MARKETPLACE_BY_ID.get(search.marketplace);
    if (!marketplace) throw new Error('Marketplace desconhecido.');
    if (selected.has(marketplace.id)) continue;
    selected.add(marketplace.id);
    const category = search.category || null;
    if (category && !marketplace.categories.some(item => item.id === category)) throw new Error(`Categoria inválida para ${marketplace.name}.`);
    addLink(marketplace, buildMarketplaceUrl(marketplace.id, term, { min, max, category, excludeInternational: data.excludeInternational }), false);
    if (marketplace.collect) {
      jobs.push({ marketplace: marketplace.id, url: buildSearchUrl(marketplace.id, term, category, { excludeInternational: data.excludeInternational }),
        category: marketplace.categories.find(item => item.id === category)?.label ?? null, custom: false });
    }
  }
  for (const raw of new Set(rawUrls.map(url => url.trim()).filter(Boolean))) {
    try {
      const parsed = parseCustomUrl(raw);
      const { marketplace } = parsed;
      // URLs extras são modelos de filtros. Se existe um nome digitado, todas
      // as fontes devem pesquisar exatamente esse nome.
      const url = term ? retargetSearchUrl(parsed.url, marketplace.id, term) : parsed.url;
      addLink(marketplace, url, true);
      if (marketplace.collect && !jobs.some(job => job.url === url && job.category === null)) jobs.push({ url, marketplace: marketplace.id, category: null, custom: true });
    } catch (error) {
      warnings.push({ url: raw, mensagem: `URL extra ignorada: ${error.message}` });
    }
  }
  if (!jobs.length && !links.length) throw new Error(warnings[0]?.mensagem || 'Escolha ao menos um marketplace ou cole uma URL de busca.');
  return { jobs, links, warnings };
}
