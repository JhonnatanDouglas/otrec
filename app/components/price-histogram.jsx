'use client';

import { useMemo } from 'react';
import { money } from './price-range';

const BINS = 28;

// Distribuição dos preços coletados, com um slider para refinar o que aparece na grade.
export default function PriceHistogram({ prices, value, onChange }) {
  const { floor, ceil, bins, peak } = useMemo(() => {
    const floor = Math.floor(Math.min(...prices));
    const ceil = Math.max(Math.ceil(Math.max(...prices)), floor + 1);
    const bins = Array(BINS).fill(0);
    for (const price of prices) bins[Math.min(BINS - 1, Math.floor(((price - floor) / (ceil - floor)) * BINS))] += 1;
    return { floor, ceil, bins, peak: Math.max(...bins) };
  }, [prices]);
  const [low, high] = value ?? [floor, ceil];
  const clampLow = Math.max(floor, Math.min(low, ceil));
  const clampHigh = Math.min(ceil, Math.max(high, floor));
  const percent = price => ((price - floor) / (ceil - floor)) * 100;
  const width = (ceil - floor) / BINS;
  const inside = prices.filter(price => price >= clampLow && price <= clampHigh).length;

  return (
    <div className="histogram">
      <div className="histogram-head">
        <span className="label">Distribuição de preços</span>
        <span className="mono">{money(clampLow)} – {money(clampHigh)} · {inside} de {prices.length}</span>
        {value && <button type="button" className="link-button" onClick={() => onChange(null)}>limpar</button>}
      </div>
      <div className="bars" aria-hidden="true">
        {bins.map((count, index) => {
          const start = floor + index * width;
          const on = start + width >= clampLow && start <= clampHigh;
          return <span key={index} className={on ? 'on' : ''} style={{ height: `${count ? Math.max(8, (count / peak) * 100) : 2}%` }} title={`${money(start)} – ${money(start + width)}: ${count}`} />;
        })}
      </div>
      <div className="slider slider-compact" style={{ '--from': `${percent(clampLow)}%`, '--to': `${percent(clampHigh)}%` }}>
        <div className="slider-track"><div className="slider-fill" /></div>
        <input type="range" min={floor} max={ceil} step="1" value={clampLow} aria-label="Refinar preço mínimo" aria-valuetext={money(clampLow)}
          onChange={event => onChange([Math.min(Number(event.target.value), clampHigh), clampHigh])} />
        <input type="range" min={floor} max={ceil} step="1" value={clampHigh} aria-label="Refinar preço máximo" aria-valuetext={money(clampHigh)}
          onChange={event => onChange([clampLow, Math.max(Number(event.target.value), clampLow)])} />
      </div>
    </div>
  );
}
