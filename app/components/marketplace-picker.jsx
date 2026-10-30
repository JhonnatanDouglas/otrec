'use client';

import { MARKETPLACES, UNAVAILABLE } from '../../lib/marketplaces';

export function Monogram({ marketplace, size = 'md' }) {
  return <span className={`monogram monogram-${size}`} style={{ '--brand': marketplace.color, '--brand-ink': marketplace.ink || '#fff' }} aria-hidden="true">{marketplace.monogram}</span>;
}

export default function MarketplacePicker({ value, onChange }) {
  // onChange recebe uma função de atualização para que cliques rápidos não usem estado antigo.
  const toggle = id => onChange(markets => ({ ...markets, [id]: { ...markets[id], on: !markets[id]?.on } }));
  const setCategory = (id, category) => onChange(markets => ({ ...markets, [id]: { ...markets[id], on: true, category } }));

  return (
    <div className="markets">
      {MARKETPLACES.map(marketplace => {
        const state = value[marketplace.id] || {};
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
              <span className={`tag ${marketplace.priceFilter === 'local' ? 'tag-soft' : 'tag-lime'}`} title={marketplace.priceFilter === 'local' ? 'O marketplace não aceita faixa de preço na busca; o filtro é feito aqui.' : 'A faixa de preço vai na própria busca do marketplace.'}>
                {marketplace.priceFilter === 'local' ? 'filtro local' : 'R$ na busca'}
              </span>
            </div>
          </div>
        );
      })}
      <div className="markets-locked">
        <span>Bloqueiam coleta por servidor:</span>
        {UNAVAILABLE.map(marketplace => (
          <span key={marketplace.name} className="locked-chip" title={marketplace.reason}>
            <Monogram marketplace={marketplace} size="xs" />{marketplace.name}<small>{marketplace.reason}</small>
          </span>
        ))}
      </div>
    </div>
  );
}
