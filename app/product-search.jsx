'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MARKETPLACES, MARKETPLACE_BY_ID } from '../lib/marketplaces';
import { buildSearchPlan, MAX_CUSTOM_URLS } from '../lib/search-plan';
import { summarizeMarkets } from '../lib/search-results';
import MarketplacePicker, { Monogram } from './components/marketplace-picker';
import PriceHistogram from './components/price-histogram';
import PriceRange, { money, rangeLabel } from './components/price-range';
import HeaderMusic from './components/header-music';
import ProductCard, { discountOf } from './components/product-card';

const STORAGE_KEY = 'otrec:form:v3';
const emptySnapshot = { status: 'aguardando', paginasColetadas: 0, descartadosInternacionais: 0, descartadosPreco: 0, descartadosCategoria: 0, duplicados: 0, erros: [], eventos: [], produtos: [], fontes: [], duracao: 0 };
const statusText = { aguardando: 'Pronto para garimpar', executando: 'Garimpando…', concluido: 'Coleta concluída', concluido_com_avisos: 'Concluída com avisos', buscas_prontas: 'Buscas externas prontas', falha: 'Não foi possível coletar', cancelado: 'Coleta interrompida' };
const sourceStatus = { 'na fila': 'na fila', coletando: 'lendo', concluido: 'ok', erro: 'erro' };
const SUGGESTIONS = ['fone bluetooth', 'ssd 1tb', 'air fryer', 'teclado mecânico', 'smartwatch', 'cadeira gamer'];
const defaultForm = {
  term: '',
  markets: Object.fromEntries(MARKETPLACES.map(marketplace => [marketplace.id, { on: marketplace.collect, category: '' }])),
  min: 170, max: 200, excludeInternational: true, urls: '', pages: 10, concurrency: 2, token: '',
};

function download(text, type, extension) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `otrec-${new Date().toISOString().slice(0, 10)}.${extension}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(value) { let text = String(value ?? ''); if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`; return `"${text.replaceAll('"', '""')}"`; }
const median = values => { const sorted = [...values].sort((a, b) => a - b); const middle = sorted.length >> 1; return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };

function ThemeToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('otrec:theme', next); } catch { /* armazenamento indisponível */ }
  };
  return <button type="button" className="icon-button" onClick={toggle} aria-label="Alternar tema claro/escuro"><svg className="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2" /><path d="M12 2v2.2M12 19.8V22M2 12h2.2M19.8 12H22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" /></svg><svg className="moon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.5 14.6A8.5 8.5 0 0 1 9.4 3.5a8.5 8.5 0 1 0 11.1 11.1Z" /></svg></button>;
}

export default function ProductSearch() {
  const [form, setForm] = useState(defaultForm);
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [feedback, setFeedback] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('original');
  const [onlyMarket, setOnlyMarket] = useState('');
  const [refine, setRefine] = useState(null);
  const [ready, setReady] = useState(false);
  const controller = useRef(null);
  const resultsRef = useRef(null);
  const active = snapshot.status === 'executando';

  useEffect(() => {
    let restored = defaultForm;
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved) restored = { ...restored, ...saved, markets: { ...restored.markets, ...saved.markets }, token: '' };
    } catch { /* ignora preferências corrompidas */ }
    const params = new URLSearchParams(window.location.search);
    const term = params.get('q');
    const sites = params.get('sites');
    const number = (name, minimum, maximum) => {
      const raw = params.get(name);
      const value = Number(raw);
      return raw !== null && Number.isFinite(value) && value >= minimum && value <= maximum ? raw : null;
    };
    if (term !== null) restored = { ...restored, term: term.slice(0, 120) };
    const min = number('min', 0, 10_000_000);
    const max = number('max', 0, 10_000_000);
    const pages = number('pages', 1, 100);
    if (min !== null) restored = { ...restored, min };
    if (max !== null) restored = { ...restored, max };
    if (pages !== null) restored = { ...restored, pages };
    if (params.has('international')) restored = { ...restored, excludeInternational: params.get('international') !== '1' };
    if (sites !== null) {
      const enabled = new Set(sites.split(',').filter(id => MARKETPLACE_BY_ID.has(id)));
      const markets = Object.fromEntries(MARKETPLACES.map(marketplace => {
        const requestedCategory = params.get(`cat_${marketplace.id}`) || '';
        const category = marketplace.categories.some(item => item.id === requestedCategory) ? requestedCategory : '';
        return [marketplace.id, { on: enabled.has(marketplace.id), category }];
      }));
      restored = { ...restored, markets };
    }
    restored.urls = typeof restored.urls === 'string' ? restored.urls : '';
    restored.term = typeof restored.term === 'string' ? restored.term : '';
    restored.markets = Object.fromEntries(MARKETPLACES.map(marketplace => {
      const state = restored.markets?.[marketplace.id];
      return [marketplace.id, { on: !!state?.on, category: marketplace.categories.some(item => item.id === state?.category) ? state.category : '' }];
    }));
    setForm(restored);
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const { token, ...rest } = form;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rest)); } catch { /* armazenamento indisponível */ }
  }, [form, ready]);
  useEffect(() => () => controller.current?.abort(), []);

  const set = patch => setForm(current => ({ ...current, ...patch }));
  const selected = MARKETPLACES.filter(marketplace => form.markets[marketplace.id]?.on);
  const customUrls = form.urls.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
  const searchInput = {
    term: form.term.trim(),
    searches: selected.map(marketplace => ({ marketplace: marketplace.id, category: form.markets[marketplace.id]?.category || null })),
    urls: customUrls,
    min: Number(form.min), max: Number(form.max), pages: Number(form.pages), concurrency: Number(form.concurrency),
    excludeInternational: form.excludeInternational,
  };
  const searchPlan = useMemo(() => {
    try { return { ...buildSearchPlan(searchInput), error: '' }; }
    catch (error) { return { jobs: [], links: [], warnings: [], error: error.message }; }
  }, [form]);
  const searchLinks = searchPlan.links.map(link => ({ ...link, marketplace: MARKETPLACE_BY_ID.get(link.marketplaceId) }));
  const resultMarkets = useMemo(() => summarizeMarkets(snapshot), [snapshot]);
  const focusedMarket = resultMarkets.find(item => item.marketplace.id === onlyMarket);

  const products = useMemo(() => {
    const needle = search.toLocaleLowerCase('pt-BR');
    const result = snapshot.produtos.filter(product => (!needle || product.nome.toLocaleLowerCase('pt-BR').includes(needle))
      && (!onlyMarket || product.marketplaceId === onlyMarket)
      && (!refine || (product.preco >= refine[0] && product.preco <= refine[1])));
    if (sort === 'price') result.sort((a, b) => a.preco - b.preco);
    if (sort === 'price-desc') result.sort((a, b) => b.preco - a.preco);
    if (sort === 'rating') result.sort((a, b) => (b.avaliacao ?? -1) - (a.avaliacao ?? -1) || (b.quantidadeAvaliacoes ?? 0) - (a.quantidadeAvaliacoes ?? 0));
    if (sort === 'reviews') result.sort((a, b) => (b.quantidadeAvaliacoes ?? -1) - (a.quantidadeAvaliacoes ?? -1));
    if (sort === 'discount') result.sort((a, b) => discountOf(b) - discountOf(a));
    return result;
  }, [snapshot.produtos, search, sort, onlyMarket, refine]);

  const insights = useMemo(() => {
    const list = snapshot.produtos;
    if (!list.length) return null;
    const prices = list.map(product => product.preco);
    const cheapest = list.reduce((best, product) => (product.preco < best.preco ? product : best));
    const bestDeal = list.reduce((best, product) => (discountOf(product) > discountOf(best) ? product : best));
    return { prices, cheapest, bestDeal, median: median(prices) };
  }, [snapshot.produtos]);

  async function submit(event) {
    event.preventDefault();
    if (controller.current) return;
    setFeedback('');
    if (searchPlan.error) return setFeedback(searchPlan.error);
    const share = new URLSearchParams();
    share.set('q', form.term.trim());
    share.set('min', String(form.min));
    share.set('max', String(form.max));
    share.set('sites', selected.map(marketplace => marketplace.id).join(','));
    share.set('pages', String(form.pages));
    share.set('international', form.excludeInternational ? '0' : '1');
    for (const marketplace of selected) {
      const category = form.markets[marketplace.id]?.category;
      if (category) share.set(`cat_${marketplace.id}`, category);
    }
    window.history.replaceState(null, '', `${window.location.pathname}?${share}`);
    setSnapshot({ ...emptySnapshot, links: searchPlan.links });
    setRefine(null);
    setOnlyMarket('');
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (!searchPlan.jobs.length) {
      setSnapshot({ ...emptySnapshot, status: 'buscas_prontas', links: searchPlan.links });
      setFeedback('Buscas externas prontas. Abra os marketplaces abaixo para ver os resultados.');
      return;
    }
    const abortController = new AbortController();
    controller.current = abortController;
    setSnapshot({ ...emptySnapshot, status: 'executando', links: searchPlan.links });
    try {
      const response = await fetch('/api/collect', {
        method: 'POST',
        signal: abortController.signal,
        headers: { 'Content-Type': 'application/json', ...(form.token ? { 'X-App-Token': form.token } : {}) },
        body: JSON.stringify(searchInput),
      });
      if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.erro || 'Falha na requisição.'); }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      const receive = message => {
        if (message.type === 'snapshot') {
          finished = message.data.status !== 'executando';
          setSnapshot({ ...emptySnapshot, ...message.data });
        }
        if (message.type === 'error') throw new Error(message.data.mensagem);
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line) continue;
          receive(JSON.parse(line));
        }
        if (done) {
          if (buffer.trim()) receive(JSON.parse(buffer));
          break;
        }
      }
      if (!finished) throw new Error('A conexão terminou antes da conclusão da coleta. Tente novamente.');
    } catch (error) {
      if (error.name === 'AbortError') setSnapshot(current => ({ ...current, status: 'cancelado' }));
      else { setFeedback(`${error.message} As buscas diretas continuam disponíveis nos links abaixo.`); setSnapshot(current => ({ ...current, status: current.produtos.length ? 'concluido_com_avisos' : 'falha' })); }
    } finally { controller.current = null; }
  }
  function cancel() { controller.current?.abort(); setFeedback('Interrompendo a coleta…'); }
  function exportJson() { download(JSON.stringify(snapshot, null, 2), 'application/json', 'json'); }
  function exportCsv() {
    const keys = ['marketplace', 'id', 'nome', 'preco', 'precoOriginal', 'avaliacao', 'quantidadeAvaliacoes', 'vendidos', 'vendedor', 'categoria', 'internacional', 'link', 'pagina', 'posicao'];
    const decimal = value => (typeof value === 'number' ? value.toFixed(2).replace('.', ',') : value);
    const rows = snapshot.produtos.map(product => keys.map(key => csvCell(key.startsWith('preco') ? decimal(product[key]) : product[key])).join(';'));
    download(`﻿${[keys.join(';'), ...rows].join('\r\n')}`, 'text/csv;charset=utf-8', 'csv');
  }

  const showSkeleton = active && !snapshot.produtos.length;
  const tickerItems = [...MARKETPLACES.map(marketplace => marketplace.name), 'faixa de preço na busca', 'sem compra internacional', 'CSV + JSON', 'resultados ao vivo'];

  return <>
    <header className="topbar">
      <a className="brand" href="/"><span className="brand-mark" aria-hidden="true">⌕</span><span><b>otrec</b></span></a>
      <div className="topbar-right"><HeaderMusic /><span className="pill"><i className={`dot${active ? ' live' : ''}`} />{active ? 'coletando agora' : 'serverless · Vercel'}</span><ThemeToggle /></div>
    </header>

    <main>
      <section className="hero">
        <span className="sticker sticker-lime">✦ {MARKETPLACES.length} marketplaces, 1 busca</span>
        <h1>Garimpe o preço certo <span className="hl">na internet inteira.</span></h1>
        <p>Compare os produtos coletados da Amazon, KaBuM!, AliExpress e Americanas. Nas demais lojas, consulte os links de busca. Ajuste a faixa de preço e a origem para encontrar seus achados.</p>
        <div className="sticker sticker-burst" aria-hidden="true">R$<br />certo</div>
      </section>

      <div className="ticker" aria-hidden="true"><div>{[...tickerItems, ...tickerItems].map((item, index) => <span key={index}>{item}<i>✦</i></span>)}</div></div>

      <form className="builder" onSubmit={submit}>
        <div className="step step-search">
          <div className="step-head"><span className="step-num">01</span><h2>O que você quer?</h2></div>
          <div className="searchbox">
            <span aria-hidden="true">⌕</span>
            <input aria-label="Produto" placeholder="fone bluetooth, ssd 1tb, air fryer…" value={form.term} maxLength={120} onChange={event => set({ term: event.target.value })} />
          </div>
          <div className="suggestions">{SUGGESTIONS.map(term => <button key={term} type="button" className="chip chip-ghost" onClick={() => set({ term })}>{term}</button>)}</div>
          <p className="search-tip"><b>Dica:</b> termos curtos e diretos trazem mais anúncios. A mesma busca vai para todos os marketplaces escolhidos ao mesmo tempo.</p>
        </div>

        <div className="step step-price">
          <div className="step-head"><span className="step-num">02</span><h2>Quanto você pode pagar?</h2></div>
          <PriceRange min={form.min} max={form.max} onChange={set} />
          <label className="switch">
            <input type="checkbox" checked={form.excludeInternational} onChange={event => set({ excludeInternational: event.target.checked })} />
            <span className="switch-ui" aria-hidden="true" />
            <span>Excluir compra internacional <small>selo da Amazon, “envio internacional” e similares</small></span>
          </label>
        </div>

        <div className="step step-markets">
          <div className="step-head"><span className="step-num">03</span><h2>Onde procurar?</h2><span className="step-aside">{selected.length} selecionado{selected.length === 1 ? '' : 's'}</span></div>
          <MarketplacePicker value={form.markets} links={searchLinks} onChange={update => setForm(current => ({ ...current, markets: update(current.markets) }))} />
        </div>

        <details className="step step-advanced">
          <summary><span className="step-num">+</span> Opções avançadas <small>URLs próprias, páginas, chave de acesso</small></summary>
          <div className="advanced-grid">
            <div className="field field-wide">
              <label htmlFor="urls">URLs de busca extras <small>(até {MAX_CUSTOM_URLS}, uma por linha, dos oito sites)</small></label>
              <textarea id="urls" rows="3" value={form.urls} onChange={event => set({ urls: event.target.value })} placeholder={'https://www.amazon.com.br/s?k=fone&rh=…\nhttps://www.kabum.com.br/hardware/ssd'} />
              <small>Links dos outros marketplaces abrem no próprio site. Uma URL inválida não cancela as outras buscas.</small>
              <small>As URLs extras funcionam como modelos de filtros: o produto nelas é sempre substituído pelo nome digitado acima. Sem um nome digitado, o termo original da URL é mantido.</small>
              {!!form.urls && <button className="link-button" type="button" onClick={() => set({ urls: '' })}>Limpar URLs extras</button>}
            </div>
            <div className="field"><label htmlFor="pages">Páginas por busca</label><input id="pages" type="number" min="1" max="100" value={form.pages} onChange={event => set({ pages: event.target.value })} /></div>
            <div className="field"><label htmlFor="concurrency">Buscas simultâneas</label><input id="concurrency" type="number" min="1" max="3" value={form.concurrency} onChange={event => set({ concurrency: event.target.value })} /></div>
            <div className="field field-wide"><label htmlFor="token">Chave de acesso</label><input id="token" type="password" value={form.token} onChange={event => set({ token: event.target.value })} autoComplete="current-password" placeholder="Só se APP_TOKEN estiver configurado na Vercel" /></div>
          </div>
        </details>

        <div className="launch">
          <div className="launch-summary">
            <strong>{form.term.trim() || 'Seu produto'}</strong>
            <span>{selected.length ? selected.map(marketplace => marketplace.name).join(' + ') : 'nenhum marketplace'}{customUrls.length ? ` + ${customUrls.length} URL${customUrls.length > 1 ? 's' : ''}` : ''} · {rangeLabel(form.min, form.max)}</span>
          </div>
          {active
            ? <button className="btn btn-ghost" type="button" onClick={cancel}>Interromper</button>
            : <button className="btn btn-primary" type="submit" disabled={!ready}>Garimpar agora <span aria-hidden="true">→</span></button>}
        </div>
        {feedback && <p className="feedback" role="status" aria-live="polite">{feedback}</p>}
        {!!searchPlan.warnings.length && <div className="feedback" role="status">{searchPlan.warnings.map((warning, index) => <p key={index}>{warning.mensagem} <small>{warning.url}</small></p>)}</div>}
      </form>

      <section className="results" ref={resultsRef}>
        {!!searchLinks.length && (
          <div className="external-searches" aria-label="Buscas nos marketplaces">
            <div className="external-searches-head">
              <div><span className="eyebrow">buscas prontas</span><h2>Abra direto no marketplace</h2></div>
              <p>Use estes links quando a coleta no app não estiver disponível ou o site bloquear o servidor.</p>
            </div>
            <div className="external-search-grid">
              {searchLinks.map(({ marketplace, url, custom }) => (
                <a key={url} className="external-search" href={url} target="_blank" rel="noopener noreferrer" style={{ '--brand': marketplace.color }}>
                  <Monogram marketplace={marketplace} size="sm" />
                  <span><strong>{marketplace.name}</strong><small>{custom ? 'URL personalizada' : marketplace.collect ? 'alternativa à coleta' : 'busca externa'}</small></span>
                  <b aria-hidden="true">↗</b>
                </a>
              ))}
            </div>
          </div>
        )}
        <div className="results-head">
          <div><span className="eyebrow">seus achados</span><h2>{snapshot.produtos.length} produto{snapshot.produtos.length === 1 ? '' : 's'}{snapshot.filtros?.termo ? <> para <span className="hl">“{snapshot.filtros.termo}”</span></> : null}</h2></div>
          <span className={`status status-${snapshot.status}`}><i className={`dot${active ? ' live' : ''}`} />{statusText[snapshot.status]}{snapshot.duracao ? ` · ${snapshot.duracao}s` : ''}</span>
        </div>

        {!!snapshot.fontes.length && (
          <div className="sources">
            {snapshot.fontes.map(source => {
              const marketplace = MARKETPLACE_BY_ID.get(source.marketplaceId);
              return (
                <div key={source.id} className={`source source-${source.status.replace(' ', '-')}`} title={source.erro || source.url}>
                  <Monogram marketplace={marketplace} size="sm" />
                  <span className="source-name">{source.marketplace}{source.categoria ? <small> · {source.categoria}</small> : source.personalizada ? <small> · URL própria</small> : null}</span>
                  <span className="source-stats mono">{source.paginas}p · {source.aceitos}✓</span>
                  <span className="source-state">{sourceStatus[source.status]}</span>
                  {source.aceitos === 0 && source.status === 'concluido' && <span className="source-detail">{summarizeMarkets({ fontes: [source], produtos: [] })[0]?.message}</span>}
                  {source.erro && <span className="source-error">{source.erro}</span>}
                </div>
              );
            })}
          </div>
        )}

        <div className="metrics">
          <div><strong>{snapshot.paginasColetadas}</strong><span>páginas lidas</span></div>
          <div><strong>{snapshot.descartadosPreco}</strong><span>fora da faixa / sem preço</span></div>
          <div><strong>{snapshot.descartadosInternacionais}</strong><span>internacionais / origem não confirmada</span></div>
          <div><strong>{snapshot.duplicados}</strong><span>repetidos ignorados</span></div>
          {snapshot.descartadosCategoria > 0 && <div><strong>{snapshot.descartadosCategoria}</strong><span>fora da categoria</span></div>}
        </div>

        {insights && (
          <div className="insights">
            <div className="insight insight-lime"><span>menor preço</span><strong>{money(insights.cheapest.preco, 2)}</strong><small>{insights.cheapest.marketplace}</small></div>
            <div className="insight"><span>preço mediano</span><strong>{money(insights.median, 2)}</strong><small>entre {insights.prices.length} achados</small></div>
            {discountOf(insights.bestDeal) > 0 && <div className="insight insight-pink"><span>maior desconto</span><strong>−{discountOf(insights.bestDeal)}%</strong><small title={insights.bestDeal.nome}>{insights.bestDeal.nome}</small></div>}
          </div>
        )}

        {insights && insights.prices.length > 1 && <PriceHistogram prices={insights.prices} value={refine} onChange={setRefine} />}

        <div className="toolbar">
          <div className="searchbox searchbox-sm"><span aria-hidden="true">⌕</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Filtrar pelo nome" aria-label="Filtrar produtos pelo nome" /></div>
          <select value={sort} onChange={event => setSort(event.target.value)} aria-label="Ordenação">
            <option value="original">Ordem da coleta</option>
            <option value="price">Menor preço</option>
            <option value="price-desc">Maior preço</option>
            <option value="discount">Maior desconto</option>
            <option value="rating">Melhor avaliação</option>
            <option value="reviews">Mais avaliações</option>
          </select>
          <button type="button" className="btn btn-small" disabled={!snapshot.produtos.length} onClick={exportCsv}>CSV ↓</button>
          <button type="button" className="btn btn-small" disabled={!snapshot.produtos.length} onClick={exportJson}>JSON ↓</button>
        </div>

        {!!resultMarkets.length && (
          <div className="market-filter" role="group" aria-label="Filtrar por marketplace">
            <button type="button" className={`chip${!onlyMarket ? ' is-on' : ''}`} aria-pressed={!onlyMarket} onClick={() => setOnlyMarket('')}>Todos <em>{snapshot.produtos.length}</em></button>
            {resultMarkets.map(({ marketplace, count, message }) => {
              const id = marketplace.id;
              return <button key={id} type="button" className={`chip${onlyMarket === id ? ' is-on' : ''}`} aria-pressed={onlyMarket === id} title={message} onClick={() => setOnlyMarket(onlyMarket === id ? '' : id)}><Monogram marketplace={marketplace} size="xs" />{marketplace.name} <em>{count}{!marketplace.collect ? ' · externo' : ''}</em></button>;
            })}
          </div>
        )}

        {focusedMarket && <div className="market-explanation" role="status">
          <strong>{focusedMarket.marketplace.name}: </strong>{focusedMarket.message}
          {focusedMarket.url && <a href={focusedMarket.url} target="_blank" rel="noopener noreferrer">Abrir busca na {focusedMarket.marketplace.name} ↗</a>}
        </div>}

        {products.length ? (
          <div className="grid">{products.map(product => <ProductCard key={`${product.marketplaceId}:${product.id}`} product={product} cheapest={product === insights?.cheapest} />)}</div>
        ) : showSkeleton ? (
          <div className="grid">{Array.from({ length: 8 }, (_, index) => <div key={index} className="card skeleton"><div className="card-media" /><div className="card-body"><i /><i /><i className="short" /></div></div>)}</div>
        ) : (
          <div className="empty">
            <div className="empty-art" aria-hidden="true"><span>⌕</span></div>
            <h3>{focusedMarket?.count === 0 ? `Nenhum produto de ${focusedMarket.marketplace.name} nesta lista` : snapshot.produtos.length ? 'Nada com esses filtros' : snapshot.status === 'buscas_prontas' ? 'Suas buscas estão prontas nos links acima' : snapshot.status === 'aguardando' ? 'Sua próxima descoberta começa aqui' : snapshot.erros.length || snapshot.status === 'falha' ? 'Use a busca direta nos marketplaces' : 'Nenhum produto passou nos critérios'}</h3>
            <p>{focusedMarket?.count === 0 ? focusedMarket.message : snapshot.produtos.length ? 'Afrouxe o filtro de nome, marketplace ou preço acima.' : snapshot.status === 'buscas_prontas' ? 'Clique na loja desejada para ver os produtos. Essas lojas exibem os resultados no próprio site.' : snapshot.status === 'aguardando' ? 'Monte a busca acima e aperte “Garimpar agora”. Os produtos aparecem aqui enquanto as páginas são lidas.' : snapshot.erros.length || snapshot.status === 'falha' ? 'A coleta encontrou um problema. Os links de busca acima continuam disponíveis; veja o motivo em cada fonte.' : 'Tente uma faixa de preço mais larga, outro termo ou mais páginas. O filtro internacional pode descartar produtos sem origem confirmada.'}</p>
          </div>
        )}

        {!!snapshot.erros.length && <div className="warnings" role="status">{snapshot.erros.map((error, index) => <div className="callout" key={`${error.url}-${index}`}><strong>{error.marketplace || 'Aviso'}:</strong> {error.mensagem}</div>)}</div>}

        <details className="activity">
          <summary>Log da coleta</summary>
          <pre>{snapshot.eventos.join('\n') || (active ? 'Conectando aos marketplaces…' : 'Nenhuma coleta iniciada.')}</pre>
        </details>
      </section>

      <footer>
        <span><b>otrec</b></span>
        <span>A ausência de selo internacional não garante origem nacional. Quando a coleta não é possível, o app gera uma busca pronta para abrir no marketplace.</span>
      </footer>
    </main>
  </>;
}
