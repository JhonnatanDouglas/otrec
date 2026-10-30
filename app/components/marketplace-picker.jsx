'use client';

import { MARKETPLACES } from '../../lib/marketplaces';

export function Monogram({ marketplace, size = 'md' }) {
  return <span className={`monogram monogram-${size}`} style={{ '--brand': marketplace.color, '--brand-ink': marketplace.ink || '#fff' }} aria-hidden="true">{marketplace.monogram}</span>;
}

export default function MarketplacePicker({ value, links = [], onChange }) {
  // onChange recebe uma função de atualização para que cliques rápidos não usem estado antigo.
  const toggle = id => onChange(markets => ({ ...markets, [id]: { ...markets[id], on: !markets[id]?.on } }));
  const setCategory = (id, category) => onChange(markets => ({ ...markets, [id]: { ...markets[id], on: true, category } }));

  return (
    <div className="markets">
      {MARKETPLACES.map(marketplace => {
        const state = value[marketplace.id] || {};
        const directLink = links.find(link => link.marketplaceId === marketplace.id && !link.custom);
        return (
          <div key={marketplace.id} className={`market-card${state.on ? ' is-on' : ''}`} style={{ '--brand': marketplace.color }}>
            <button type="button" className="market-toggle" aria-pressed={!!state.on} onClick={() => toggle(marketplace.id)}>
              <Monogram marketplace={marketplace} size="lg" />
              <span className="market-text">
                <strong>{marketplace.name}</strong>
                <small>{marketplace.blurb}</small>
              </span>
              <span className="market-check" aria-hidden="true">{state.on ? '✓' : '+'}</span>
            </button>
            <div className="market-foot">
              {marketplace.categories.length ? (
                <select aria-label={`Categoria no ${marketplace.name}`} value={state.category || ''} onChange={event => setCategory(marketplace.id, event.target.value)}>
                  <option value="">Todas as categorias</option>
                  {marketplace.categories.map(category => <option key={category.id} value={category.id}>{category.label}</option>)}
                </select>
              ) : <span className="market-note">Busca em todas as categorias</span>}
              {directLink ? <a className="tag tag-lime" href={directLink.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir busca na ${marketplace.name}`}>Abrir busca ↗</a>
                : <span className={`tag ${marketplace.priceFilter === 'local' ? 'tag-soft' : 'tag-lime'}`}>
                  {marketplace.collect ? 'coleta no app' : 'selecione para buscar'}
                </span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
