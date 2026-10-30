import * as cheerio from 'cheerio';
import { MARKETPLACE_BY_ID, buildSearchUrl, marketplaceForHost, slugify } from './marketplaces.js';

const INTERNATIONAL = /11tVhj88LYL|compra\s+internacional|envio\s+internacional|enviado\s+do\s+exterior/i;
const HUMAN_CHECK_PATH = /account-verification|captcha|punish|validatecaptcha|_____tmd_____/i;
const MAX_RETRY_AFTER = 60;
const SAFE_DURATION_MS = 260_000;
const MAX_HTML_BYTES = 6_000_000;
const MAX_JOBS = 8;
const PAUSE_MS = { amazon: 2000, kabum: 1000 };
// O KaBuM! filtra pelo preço cheio, e o app pelo preço à vista (até ~15% menor):
// o teto enviado ao site é folgado e o corte exato acontece aqui.
const KABUM_LIST_PRICE_SLACK = 1.25;

export function parsePrice(text) {
  const value = String(text || '').replace(/[^\d,.]/g, '');
  if (!value) return null;
  const parsed = Number(value.replaceAll('.', '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

const URL_ERROR = 'Use uma URL HTTPS da Amazon Brasil ou do KaBuM!.';

export function validateUrl(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new Error(URL_ERROR); }
  if (url.protocol !== 'https:' || !marketplaceForHost(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) {
    throw new Error(URL_ERROR);
  }
  url.hash = '';
  return url.href;
}

const marketplaceOf = rawUrl => marketplaceForHost(new URL(rawUrl).hostname);

// Só páginas de listagem têm os cartões que o coletor sabe ler.
export function isListingUrl(rawUrl) {
  const { pathname } = new URL(rawUrl);
  if (marketplaceOf(rawUrl).id === 'amazon') return pathname === '/s' || pathname.startsWith('/s/') || pathname === '/b' || pathname.startsWith('/b/');
  return pathname.length > 1 && !pathname.startsWith('/produto/');
}

export function configuration(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Configuração inválida.');
  const rawUrls = data.urls ?? [];
  const searches = data.searches ?? [];
  if (!Array.isArray(rawUrls) || rawUrls.length > 3 || rawUrls.some(url => typeof url !== 'string')) throw new Error('Informe até 3 URLs personalizadas.');
  if (!Array.isArray(searches) || searches.length > MARKETPLACE_BY_ID.size || searches.some(item => !item || typeof item !== 'object')) throw new Error('Seleção de marketplaces inválida.');
  const term = typeof data.term === 'string' ? data.term.trim() : '';
  if (searches.length && (!term || term.length > 120)) throw new Error('Digite o que você procura (até 120 caracteres).');

  const jobs = [];
  for (const search of searches) {
    const marketplace = MARKETPLACE_BY_ID.get(search.marketplace);
    if (!marketplace) throw new Error('Marketplace desconhecido.');
    if (jobs.some(job => job.marketplace === marketplace.id && job.custom === false)) continue;
    const category = search.category ? marketplace.categories.find(item => item.id === search.category) : null;
    jobs.push({ url: buildSearchUrl(marketplace.id, term, search.category || null), marketplace: marketplace.id, category: category?.label ?? null, custom: false });
  }
  for (const url of new Set(rawUrls.map(validateUrl))) {
    const marketplace = marketplaceOf(url).id;
    if (!isListingUrl(url)) throw new Error(`Cole uma página de busca ou categoria, não de produto: ${marketplace === 'amazon' ? 'amazon.com.br/s?k=…' : 'kabum.com.br/busca/… ou kabum.com.br/<departamento>'}.`);
    jobs.push({ url, marketplace, category: null, custom: true });
  }
  if (!jobs.length) throw new Error('Escolha ao menos um marketplace ou cole uma URL de busca.');
  if (jobs.length > MAX_JOBS) throw new Error(`Use no máximo ${MAX_JOBS} buscas por coleta.`);

  const min = Number(data.min ?? 170);
  const max = Number(data.max ?? 200);
  const pages = Number(data.pages ?? 10);
  const concurrency = Number(data.concurrency ?? 2);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || min >= max || max > 10_000_000) {
    throw new Error('Informe preços válidos, com máximo maior que mínimo.');
  }
  if (!Number.isInteger(pages) || pages < 1 || pages > 100 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) {
    throw new Error('Use de 1 a 100 páginas e de 1 a 3 buscas simultâneas.');
  }
  if (typeof data.excludeInternational !== 'boolean') throw new Error('Filtro internacional inválido.');
  return { term, jobs, min, max, pages, concurrency, excludeInternational: data.excludeInternational };
}

function text($element) {
  return $element.first().text().replace(/\s+/g, ' ').trim();
}

const finite = value => (Number.isFinite(value) && value > 0 ? value : null);

function extractAmazon($, rawUrl, page) {
  const products = $('[data-component-type="s-search-result"][data-asin]').toArray().flatMap((card, index) => {
    const $card = $(card);
    const id = $card.attr('data-asin');
    if (!id) return [];
    const rating = text($card.find('.a-icon-alt'));
    const score = rating.match(/\d+(?:[,.]\d+)?/);
    const reviews = $card.find('a[aria-label]').toArray().map(anchor => $(anchor).attr('aria-label')).find(label => /^[\d.]+\s+(classifica|avalia)/i.test(label))
      || text($card.find('.s-underline-text.a-size-base'));
    const image = $card.find('img.s-image').first();
    const preco = parsePrice(text($card.find('.a-price:not(.a-text-price) .a-offscreen')));
    const original = parsePrice(text($card.find('.a-price.a-text-price .a-offscreen')));
    return [{
      id,
      nome: text($card.find('h2')) || 'Produto sem título',
      preco,
      precoOriginal: original && preco && original > preco ? original : null,
      avaliacao: score ? Number(score[0].replace(',', '.')) : null,
      quantidadeAvaliacoes: reviews ? Number(reviews.replace(/\D/g, '')) || 0 : null,
      imagem: image.attr('src') || image.attr('data-src') || null,
      link: `https://www.amazon.com.br/dp/${id}`,
      pagina: page,
      posicao: index + 1,
      internacional: INTERNATIONAL.test(`${$card.text()} ${$.html(card)}`),
    }];
  });
  const next = $('a.s-pagination-next').first();
  return { products, nextUrl: next.attr('href') ? new URL(next.attr('href'), rawUrl).href : null };
}

function extractKabum($, rawUrl, page) {
  const raw = $('script#__NEXT_DATA__').first().text();
  if (!raw) return { products: [], nextUrl: null };
  let data = JSON.parse(raw)?.props?.pageProps?.data;
  if (typeof data === 'string') data = JSON.parse(data);
  const catalog = data?.catalogServer;
  const items = Array.isArray(catalog?.data) ? catalog.data : [];
  const products = items.flatMap((item, index) => {
    if (!item?.code) return [];
    const preco = item.available === false ? null : finite(item.offer?.priceWithDiscount) ?? finite(item.priceWithDiscount) ?? finite(item.price);
    const original = finite(item.oldPrice) ?? finite(item.price);
    return [{
      id: String(item.code),
      nome: String(item.name || 'Produto sem título').trim(),
      preco,
      precoOriginal: original && preco && original > preco ? original : null,
      avaliacao: item.ratingCount ? finite(item.averageRating) : null,
      quantidadeAvaliacoes: Number.isInteger(item.ratingCount) ? item.ratingCount : null,
      imagem: item.thumbnail || item.image || null,
      link: `https://www.kabum.com.br/produto/${item.code}/${slugify(item.friendlyName || item.name)}`,
      pagina: page,
      posicao: index + 1,
      internacional: INTERNATIONAL.test(item.name || ''),
      vendedor: item.sellerName || null,
      categoria: item.category || null,
    }];
  });
  const { current, next, total } = catalog?.pagination || {};
  let nextUrl = null;
  if (Number.isInteger(next) && next > current && next <= total) {
    const url = new URL(rawUrl);
    url.searchParams.set('page_number', String(next));
    nextUrl = url.href;
  }
  return { products, nextUrl };
}

export function extract(source, rawUrl, page) {
  const $ = cheerio.load(source);
  const title = $('title').first().text();
  if (/captcha|robot check|verifica|access denied/i.test(title) || $('form[action*="validateCaptcha"]').length) {
    throw new Error('O marketplace solicitou verificação humana. Coleta interrompida.');
  }
  // Desafio antirrobô do Akamai Bot Manager: página quase vazia que exige executar JavaScript.
  if (/bm-verify|\/_sec\/verify|triggerInterstitialChallenge/.test(source)) {
    throw new Error('O marketplace respondeu com um desafio antirrobô (Akamai) para este servidor. Tente novamente mais tarde, com menos páginas.');
  }
  const marketplace = marketplaceOf(rawUrl);
  const result = marketplace.id === 'amazon' ? extractAmazon($, rawUrl, page) : extractKabum($, rawUrl, page);
  result.products = result.products.map(product => ({ ...product, marketplace: marketplace.name, marketplaceId: marketplace.id }));
  return result;
}

function retryAfterSeconds(value) {
  if (!value) return null;
  const numeric = Number(value);
  const seconds = Number.isInteger(numeric) ? numeric : Math.round((Date.parse(value) - Date.now()) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= MAX_RETRY_AFTER ? seconds : null;
}

function abortError() {
  return new DOMException('Coleta cancelada.', 'AbortError');
}

async function pause(milliseconds, signal, deadline) {
  if (signal?.aborted) throw abortError();
  if (Date.now() + milliseconds >= deadline) throw new Error('A coleta atingiu o limite seguro de execução da Vercel e foi encerrada com resultados parciais.');
  await new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => { clearTimeout(timer); reject(abortError()); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; ProductResearch/2.0)',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  Accept: 'text/html,application/xhtml+xml',
};

// Retorna o HTML e a URL final, depois de seguir redirecionamentos dentro do marketplace.
// `rewrite` ajusta cada destino de redirecionamento antes de segui-lo.
async function requestPage(rawUrl, signal, deadline, rewrite = target => target) {
  let url = validateUrl(rawUrl);
  const origin = marketplaceOf(url).id;
  for (let redirect = 0; redirect < 6; redirect += 1) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (signal?.aborted) throw abortError();
      const timeout = AbortSignal.timeout(20_000);
      const response = await fetch(url, {
        redirect: 'manual',
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: REQUEST_HEADERS,
      }).catch(error => {
        if (signal?.aborted) throw abortError();
        if (error.name === 'TimeoutError') throw new Error('O marketplace não respondeu em até 20 segundos.');
        throw error;
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
        response.body?.cancel();
        const target = new URL(response.headers.get('location'), url);
        if (HUMAN_CHECK_PATH.test(target.pathname)) throw new Error('O marketplace exigiu verificação humana ou de conta para este servidor. Coleta interrompida.');
        url = validateUrl(rewrite(validateUrl(target.href)));
        if (marketplaceOf(url).id !== origin) throw new Error('O marketplace redirecionou para outro site.');
        break;
      }
      if (response.status === 403 || response.status === 429) {
        response.body?.cancel();
        throw new Error(`Marketplace bloqueou a coleta (HTTP ${response.status}). Tente novamente mais tarde.`);
      }
      if (response.status >= 500) {
        response.body?.cancel();
        if (attempt === 3) {
          const detail = response.status === 503 ? ' A indisponibilidade persistiu após novas tentativas.' : '';
          throw new Error(`Falha HTTP ${response.status} ao coletar a página.${detail}`);
        }
        const retryAfter = retryAfterSeconds(response.headers.get('retry-after'));
        await pause((retryAfter ?? 2 ** (attempt + 1)) * 1000, signal, deadline);
        continue;
      }
      if (!response.ok) {
        response.body?.cancel();
        throw new Error(`Falha HTTP ${response.status} ao coletar a página.`);
      }
      if (!response.headers.get('content-type')?.includes('html')) {
        response.body?.cancel();
        throw new Error('O endereço não retornou uma página HTML.');
      }
      const declared = Number(response.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_HTML_BYTES) {
        response.body?.cancel();
        throw new Error('Página excedeu o limite de 6 MB.');
      }
      const data = await response.arrayBuffer();
      if (data.byteLength > MAX_HTML_BYTES) throw new Error('Página excedeu o limite de 6 MB.');
      return { html: new TextDecoder().decode(data), url };
    }
  }
  throw new Error('O marketplace redirecionou a requisição vezes demais.');
}

// Aplica a faixa de preço na própria busca do marketplace, quando ele aceita,
// para que as páginas lidas já venham concentradas no intervalo desejado.
export function withPriceFilter(rawUrl, config) {
  const url = new URL(rawUrl);
  if (marketplaceOf(url.href).id === 'amazon') {
    const filters = (url.searchParams.get('rh') || '').split(',').filter(value => value && !value.startsWith('p_36:'));
    filters.push(`p_36:${Math.round(config.min * 100)}-${Math.round(config.max * 100)}`);
    url.searchParams.set('rh', filters.join(','));
  } else if (!url.pathname.startsWith('/busca/')) {
    // A busca do KaBuM! redireciona para a categoria e descarta parâmetros; o filtro vai na URL final.
    const price = { min: Math.floor(config.min), max: Math.ceil(Math.min(config.max * KABUM_LIST_PRICE_SLACK, 10_000_000)) };
    url.searchParams.set('facet_filters', Buffer.from(JSON.stringify({ price })).toString('base64'));
  }
  return url.href;
}

const normalize = value => slugify(value);

export async function collectProducts(config, { signal, onUpdate = () => {} } = {}) {
  const deadline = Date.now() + SAFE_DURATION_MS;
  const state = {
    status: 'executando', filtros: { termo: config.term, min: config.min, max: config.max, paginas: config.pages, excluirInternacional: config.excludeInternational },
    paginasColetadas: 0, descartadosInternacionais: 0, descartadosPreco: 0, descartadosCategoria: 0, duplicados: 0,
    erros: [], eventos: [], produtos: [], duracao: 0,
    fontes: config.jobs.map((job, index) => ({
      id: index, marketplace: MARKETPLACE_BY_ID.get(job.marketplace).name, marketplaceId: job.marketplace,
      categoria: job.category, personalizada: job.custom, url: job.url, status: 'na fila', paginas: 0, anuncios: 0, aceitos: 0, erro: null,
    })),
  };
  const started = Date.now();
  const seen = new Set();
  const snapshot = () => ({
    ...state, erros: [...state.erros], eventos: [...state.eventos.slice(-40)], produtos: [...state.produtos],
    fontes: state.fontes.map(source => ({ ...source })), duracao: Math.round((Date.now() - started) / 1000),
  });
  const update = () => onUpdate(snapshot());

  async function collectJob(job, source) {
    let url = withPriceFilter(job.url, config);
    const visited = new Set();
    // Kabum não filtra categoria junto com o termo; o filtro é feito no departamento do produto.
    const categoryMatch = job.marketplace === 'kabum' && job.category ? normalize(job.category) : null;
    source.status = 'coletando';
    update();
    try {
      for (let page = 1; page <= config.pages && !visited.has(url); page += 1) {
        if (signal?.aborted) throw abortError();
        visited.add(url);
        // A busca do KaBuM! redireciona para a categoria e perde os parâmetros: a faixa de preço é reaplicada no destino.
        const response = await requestPage(url, signal, deadline, target => withPriceFilter(target, config));
        url = response.url;
        visited.add(url);
        const { products, nextUrl } = extract(response.html, url, page);
        state.paginasColetadas += 1;
        source.paginas += 1;
        source.anuncios += products.length;
        for (const product of products) {
          const key = `${product.marketplaceId}:${product.id}`;
          if (seen.has(key)) state.duplicados += 1;
          else {
            seen.add(key);
            if (config.excludeInternational && product.internacional) state.descartadosInternacionais += 1;
            else if (product.preco === null || !(config.min < product.preco && product.preco < config.max)) state.descartadosPreco += 1;
            else if (categoryMatch && normalize(String(product.categoria || '').split('/')[0]) !== categoryMatch) state.descartadosCategoria += 1;
            else {
              state.produtos.push(product);
              source.aceitos += 1;
            }
          }
        }
        state.eventos.push(`${source.marketplace} · página ${page}: ${products.length} anúncios lidos`);
        update();
        if (!products.length) throw new Error('Nenhum anúncio reconhecido. Use uma URL de busca/listagem; a página pode exigir JavaScript ou ter mudado de estrutura.');
        if (!nextUrl) break;
        const validated = validateUrl(nextUrl);
        if (marketplaceOf(validated).id !== job.marketplace) throw new Error('Paginação apontou para outro marketplace.');
        url = validated;
        await pause(PAUSE_MS[job.marketplace], signal, deadline);
      }
      source.status = 'concluido';
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      source.status = 'erro';
      source.erro = error.message;
      state.erros.push({ url, marketplace: source.marketplace, mensagem: error.message });
    }
    update();
  }

  update();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(config.concurrency, config.jobs.length) }, async () => {
    while (cursor < config.jobs.length) {
      const index = cursor++;
      await collectJob(config.jobs[index], state.fontes[index]);
    }
  });
  try {
    await Promise.all(workers);
    state.status = state.erros.length ? 'concluido_com_avisos' : 'concluido';
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
    state.status = 'cancelado';
  }
  const result = snapshot();
  onUpdate(result);
  return result;
}
