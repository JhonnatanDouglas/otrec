import * as cheerio from 'cheerio';
import { MARKETPLACE_BY_ID, marketplaceForHost, slugify } from './marketplaces.js';
import { buildSearchPlan, isMarketplaceListing } from './search-plan.js';
import { americanasApiUrl, americanasAppScript, americanasInitialData, americanasOperationHash, extractAmericanas } from './americanas.js';

const INTERNATIONAL = /11tVhj88LYL|compra\s+internacional|envio\s+internacional|enviado\s+do\s+exterior/i;
const HUMAN_CHECK_PATH = /account-verification|captcha|punish|validatecaptcha|_____tmd_____/i;
const MAX_RETRY_AFTER = 60;
const SAFE_DURATION_MS = 260_000;
const MAX_HTML_BYTES = 6_000_000;
const PAUSE_MS = { amazon: 2000, kabum: 1000, aliexpress: 1500, americanas: 1000 };
// O KaBuM! filtra pelo preço cheio, e o app pelo preço à vista (até ~15% menor):
// o teto enviado ao site é folgado e o corte exato acontece aqui.
const KABUM_LIST_PRICE_SLACK = 1.25;

export function parsePrice(text) {
  const value = String(text || '').replace(/[^\d,.]/g, '');
  if (!value) return null;
  const parsed = Number(value.replaceAll('.', '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

const URL_ERROR = 'Use uma URL HTTPS da Amazon Brasil, do KaBuM!, do AliExpress em português ou da Americanas.';

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
  const marketplace = marketplaceOf(rawUrl);
  return !!marketplace && isMarketplaceListing(new URL(rawUrl), marketplace.id);
}

export function configuration(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Configuração inválida.');
  const term = typeof data.term === 'string' ? data.term.trim() : '';
  if (typeof data.excludeInternational !== 'boolean') throw new Error('Filtro internacional inválido.');
  const { jobs, links, warnings } = buildSearchPlan(data);

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
  return { term, jobs, links, warnings, min, max, pages, concurrency, excludeInternational: data.excludeInternational };
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

function jsonObjectAt(source, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) return JSON.parse(source.slice(start, index + 1));
  }
  throw new Error('JSON de produtos incompleto no AliExpress.');
}

function aliExpressData($) {
  const source = $('script').toArray().map(script => $(script).text()).find(textValue => textValue.includes('init-data-start'));
  if (!source) throw new Error('O AliExpress não entregou os dados dos produtos para este servidor.');
  const assignment = source.indexOf('_init_data_');
  const dataLabel = source.indexOf('data:', assignment);
  const start = source.indexOf('{', dataLabel + 5);
  if (assignment < 0 || dataLabel < 0 || start < 0) throw new Error('Formato de dados inesperado no AliExpress.');
  return jsonObjectAt(source, start);
}

function compactCount(value) {
  const match = String(value || '').match(/([\d.,]+)\s*([KM])?/i);
  if (!match) return null;
  const numeric = Number(match[1].replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.'));
  if (!Number.isFinite(numeric)) return null;
  const multiplier = match[2]?.toUpperCase() === 'M' ? 1_000_000 : match[2]?.toUpperCase() === 'K' ? 1_000 : 1;
  return Math.round(numeric * multiplier);
}

function aliExpressOrigin(item) {
  const encoded = item?.trace?.pdpParams?.pdp_cdi;
  if (!encoded) return null;
  try { return JSON.parse(decodeURIComponent(encoded)).shipFrom || null; } catch { return null; }
}

function extractAliExpress($, rawUrl, page) {
  const data = aliExpressData($);
  const root = data?.data?.root ?? data?.root;
  const items = root?.fields?.mods?.itemList?.content;
  if (!Array.isArray(items)) throw new Error('O AliExpress não retornou uma lista de produtos reconhecível.');
  const products = items.flatMap((item, index) => {
    const id = String(item?.productId || item?.redirectedId || '').trim();
    const nome = String(item?.title?.displayTitle || '').trim();
    if (!id || !nome) return [];
    const tracePrice = Number(item?.trace?.utLogMap?.salePriceAmount) / 100;
    const traceOriginal = Number(item?.trace?.utLogMap?.originPriceAmount) / 100;
    const preco = finite(tracePrice) ?? finite(item?.prices?.salePrice?.minPrice);
    const original = finite(traceOriginal);
    const origin = aliExpressOrigin(item);
    const image = item?.image?.imgUrl;
    return [{
      id,
      nome,
      preco,
      precoOriginal: original && preco && original > preco ? original : null,
      avaliacao: finite(Number(item?.evaluation?.starRating)),
      quantidadeAvaliacoes: null,
      vendidos: compactCount(item?.trade?.tradeDesc),
      imagem: image ? new URL(image, 'https://pt.aliexpress.com').href : null,
      link: `https://pt.aliexpress.com/item/${id}.html`,
      pagina: page,
      posicao: index + 1,
      internacional: origin ? origin.toUpperCase() !== 'BR' : null,
      origemEnvio: origin,
      origemDesconhecida: !origin,
      vendedor: null,
      categoria: null,
    }];
  });
  const pagination = data?.global?.screenPagination;
  let nextUrl = null;
  if (pagination?.hasNext || (Number(pagination?.current) < Number(pagination?.total))) {
    const url = new URL(rawUrl);
    url.searchParams.set('page', String(Number(pagination.current || page) + 1));
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
  const result = marketplace.id === 'amazon' ? extractAmazon($, rawUrl, page)
    : marketplace.id === 'kabum' ? extractKabum($, rawUrl, page)
      : marketplace.id === 'americanas' ? extractAmericanas(source, rawUrl, page)
        : extractAliExpress($, rawUrl, page);
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
async function requestPage(rawUrl, signal, deadline, rewrite = target => target, format = 'html') {
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
      const contentType = response.headers.get('content-type') || '';
      const expectedType = format === 'json' ? /\bjson\b/ : format === 'javascript' ? /javascript|ecmascript/ : /html/;
      if (!expectedType.test(contentType)) {
        response.body?.cancel();
        throw new Error(`O endereço não retornou ${format === 'html' ? 'uma página HTML' : `dados ${format}`} reconhecíveis.`);
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
  const marketplace = marketplaceOf(url.href).id;
  if (marketplace === 'amazon') {
    const filters = (url.searchParams.get('rh') || '').split(',').filter(value => value && !value.startsWith('p_36:'));
    filters.push(`p_36:${Math.round(config.min * 100)}-${Math.round(config.max * 100)}`);
    url.searchParams.set('rh', filters.join(','));
  } else if (marketplace === 'kabum' && !url.pathname.startsWith('/busca/')) {
    // A busca do KaBuM! redireciona para a categoria e descarta parâmetros; o filtro vai na URL final.
    const price = { min: Math.floor(config.min), max: Math.ceil(Math.min(config.max * KABUM_LIST_PRICE_SLACK, 10_000_000)) };
    url.searchParams.set('facet_filters', Buffer.from(JSON.stringify({ price })).toString('base64'));
  } else if (marketplace === 'americanas') {
    url.searchParams.set('price', `${config.min}-to-${config.max}`);
    const facets = new Set((url.searchParams.get('facets') || '').split(',').filter(Boolean));
    facets.add('price');
    url.searchParams.set('facets', [...facets].join(','));
  }
  return url.href;
}

const normalize = value => slugify(value);

export async function collectProducts(config, { signal, onUpdate = () => {} } = {}) {
  const deadline = Date.now() + SAFE_DURATION_MS;
  const state = {
    status: 'executando', filtros: { termo: config.term, min: config.min, max: config.max, paginas: config.pages, excluirInternacional: config.excludeInternational },
    paginasColetadas: 0, descartadosInternacionais: 0, descartadosPreco: 0, descartadosCategoria: 0, duplicados: 0,
    erros: [], avisos: config.warnings || [], links: config.links || [],
    eventos: (config.warnings || []).map(warning => warning.mensagem), produtos: [], duracao: 0,
    fontes: config.jobs.map((job, index) => ({
      id: index, marketplace: MARKETPLACE_BY_ID.get(job.marketplace).name, marketplaceId: job.marketplace,
      categoria: job.category, personalizada: job.custom, url: job.url, status: 'na fila', paginas: 0, anuncios: 0, aceitos: 0, erro: null,
      descartadosPreco: 0, descartadosInternacionais: 0, descartadosOrigemDesconhecida: 0, descartadosCategoria: 0, duplicados: 0,
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
    let americanasHash = null;
    const requestAmericanas = async rawUrl => {
      if (!americanasHash) {
        const initial = await requestPage(rawUrl, signal, deadline);
        if (Array.isArray(americanasInitialData(initial.html)?.search?.products?.edges)) return initial;
        const scriptUrl = americanasAppScript(initial.html, initial.url);
        const script = await requestPage(scriptUrl, signal, deadline, target => target, 'javascript');
        americanasHash = americanasOperationHash(script.html);
      }
      const response = await requestPage(americanasApiUrl(rawUrl, americanasHash, config), signal, deadline, target => target, 'json');
      return { html: response.html, url: rawUrl };
    };
    source.status = 'coletando';
    update();
    try {
      for (let page = 1; page <= config.pages && !visited.has(url); page += 1) {
        if (signal?.aborted) throw abortError();
        visited.add(url);
        // A busca do KaBuM! redireciona para a categoria e perde os parâmetros: a faixa de preço é reaplicada no destino.
        const response = job.marketplace === 'americanas' ? await requestAmericanas(url)
          : await requestPage(url, signal, deadline, target => withPriceFilter(target, config));
        url = response.url;
        visited.add(url);
        const { products, nextUrl } = extract(response.html, url, page);
        state.paginasColetadas += 1;
        source.paginas += 1;
        source.anuncios += products.length;
        for (const product of products) {
          const key = `${product.marketplaceId}:${product.id}`;
          if (seen.has(key)) { state.duplicados += 1; source.duplicados += 1; }
          else {
            seen.add(key);
            if (config.excludeInternational && (product.internacional || product.origemDesconhecida)) {
              state.descartadosInternacionais += 1;
              if (product.origemDesconhecida) source.descartadosOrigemDesconhecida += 1;
              else source.descartadosInternacionais += 1;
            } else if (product.preco === null || !(config.min < product.preco && product.preco < config.max)) { state.descartadosPreco += 1; source.descartadosPreco += 1; }
            else if (categoryMatch && normalize(String(product.categoria || '').split('/')[0]) !== categoryMatch) { state.descartadosCategoria += 1; source.descartadosCategoria += 1; }
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
    state.status = state.erros.length || state.avisos.length ? 'concluido_com_avisos' : config.jobs.length ? 'concluido' : 'buscas_prontas';
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
    state.status = 'cancelado';
  }
  const result = snapshot();
  onUpdate(result);
  return result;
}
