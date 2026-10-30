'use client';

import { MARKETPLACE_BY_ID } from '../../lib/marketplaces';
import { Monogram } from './marketplace-picker';
import { money } from './price-range';

export function safeLink(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export const discountOf = product => (product.precoOriginal && product.precoOriginal > product.preco ? Math.round((1 - product.preco / product.precoOriginal) * 100) : 0);

export default function ProductCard({ product, cheapest }) {
  const marketplace = MARKETPLACE_BY_ID.get(product.marketplaceId) || { name: product.marketplace, monogram: product.marketplace?.[0] || '?', color: '#ddd', ink: '#111' };
  const image = safeLink(product.imagem);
  const link = safeLink(product.link);
  const discount = discountOf(product);
  return (
    <article className="card">
      <div className="card-media">
        {image ? <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => event.currentTarget.remove()} /> : null}
        <span className="card-market" style={{ '--brand': marketplace.color, '--brand-ink': marketplace.ink }}><Monogram marketplace={marketplace} size="sm" />{marketplace.name}</span>
        {discount >= 5 && <span className="card-discount">−{discount}%</span>}
        {cheapest && <span className="card-flag">menor preço</span>}
      </div>
      <div className="card-body">
        <h3 title={product.nome}>{product.nome}</h3>
        <div className="card-meta">
          {product.avaliacao !== null && product.avaliacao !== undefined
            ? <span className="stars">★ {product.avaliacao.toLocaleString('pt-BR')}{product.quantidadeAvaliacoes ? <em> ({product.quantidadeAvaliacoes.toLocaleString('pt-BR')})</em> : null}</span>
            : <span className="muted">sem avaliação</span>}
          {product.vendidos && <span className="muted">{product.vendidos}</span>}
          {product.internacional && <span className="tag tag-pink">internacional</span>}
        </div>
        {(product.vendedor || product.categoria) && <div className="card-seller">{[product.vendedor, product.categoria?.split('/').slice(0, 2).join(' › ')].filter(Boolean).join(' · ')}</div>}
        <div className="card-price">
          <strong>{money(product.preco, 2)}</strong>
          {discount >= 1 && <s>{money(product.precoOriginal, 2)}</s>}
        </div>
        {link && <a className="card-cta" href={link} target="_blank" rel="noopener noreferrer">Ver oferta <span aria-hidden="true">↗</span></a>}
      </div>
    </article>
  );
}
