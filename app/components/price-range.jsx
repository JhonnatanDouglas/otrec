'use client';

import { useEffect, useState } from 'react';

export const SCALE_MAX = 20_000;
export const OPEN_MAX = 10_000_000;
const STEPS = 1000;

export const PRESETS = [
  { min: 0, max: 50, label: 'Até R$ 50' },
  { min: 50, max: 100, label: 'R$ 50–100' },
  { min: 100, max: 200, label: 'R$ 100–200' },
  { min: 170, max: 200, label: 'R$ 170–200' },
  { min: 200, max: 500, label: 'R$ 200–500' },
  { min: 500, max: 1000, label: 'R$ 500–1 mil' },
  { min: 1000, max: 2000, label: 'R$ 1–2 mil' },
  { min: 2000, max: 5000, label: 'R$ 2–5 mil' },
  { min: 5000, max: OPEN_MAX, label: 'R$ 5 mil+' },
];

export const money = (value, digits = 0) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
export const rangeLabel = (min, max) => (max >= OPEN_MAX ? `acima de ${money(min)}` : min <= 0 ? `até ${money(max)}` : `${money(min)} – ${money(max)}`);

// Escala logarítmica: o slider tem a mesma precisão para R$ 50 e para R$ 5.000.
function nice(value) {
  const step = value < 100 ? 1 : value < 1000 ? 10 : value < 5000 ? 50 : 100;
  return Math.round(value / step) * step;
}
const toPosition = value => Math.round((STEPS * Math.log(Math.min(value, SCALE_MAX) + 1)) / Math.log(SCALE_MAX + 1));
const fromPosition = position => (position >= STEPS ? OPEN_MAX : nice((SCALE_MAX + 1) ** (position / STEPS) - 1));

function MoneyInput({ id, label, value, onCommit, placeholder }) {
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(value >= OPEN_MAX ? '' : String(value).replace('.', ',')); }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const parsed = draft.trim() === '' ? (id === 'max' ? OPEN_MAX : 0) : Number(draft.replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(parsed) && parsed >= 0) onCommit(Math.min(parsed, OPEN_MAX));
  };
  return (
    <label className="money-input" htmlFor={id}>
      <span className="money-label">{label}</span>
      <span className="money-field">
        <span aria-hidden="true">R$</span>
        <input id={id} inputMode="decimal" autoComplete="off" value={draft} placeholder={placeholder}
          onFocus={() => setEditing(true)} onChange={event => setDraft(event.target.value.replace(/[^\d.,]/g, ''))} onBlur={commit}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />
      </span>
    </label>
  );
}

export default function PriceRange({ min, max, onChange }) {
  const low = toPosition(min);
  const high = max >= OPEN_MAX ? STEPS : toPosition(max);
  const setLow = position => onChange({ min: fromPosition(Math.min(position, high - 10)), max });
  const setHigh = position => onChange({ min, max: fromPosition(Math.max(position, low + 10)) });
  const preset = PRESETS.find(item => item.min === min && item.max === max);

  return (
    <div className="price-range">
      <div className="presets" role="group" aria-label="Faixas rápidas">
        {PRESETS.map(item => (
          <button key={item.label} type="button" className={`chip${preset === item ? ' is-on' : ''}`} aria-pressed={preset === item} onClick={() => onChange({ min: item.min, max: item.max })}>{item.label}</button>
        ))}
      </div>
      <div className="slider" style={{ '--from': `${low / 10}%`, '--to': `${high / 10}%` }}>
        <div className="slider-track"><div className="slider-fill" /></div>
        <input type="range" min="0" max={STEPS} value={low} onChange={event => setLow(Number(event.target.value))} aria-label="Preço mínimo" aria-valuetext={money(min)} />
        <input type="range" min="0" max={STEPS} value={high} onChange={event => setHigh(Number(event.target.value))} aria-label="Preço máximo" aria-valuetext={max >= OPEN_MAX ? 'sem limite' : money(max)} />
        <div className="slider-ticks" aria-hidden="true">{[0, 50, 200, 1000, 5000].map(tick => <span key={tick} style={{ left: `${toPosition(tick) / 10}%` }}>{tick >= 1000 ? `${tick / 1000}k` : tick}</span>)}<span style={{ left: '100%' }}>∞</span></div>
      </div>
      <div className="money-row">
        <MoneyInput id="min" label="Mínimo" value={min} onCommit={value => onChange({ min: value, max: Math.max(max, value + 1) })} placeholder="0" />
        <span className="money-dash" aria-hidden="true">→</span>
        <MoneyInput id="max" label="Máximo" value={max} onCommit={value => onChange({ min: Math.min(min, Math.max(value - 1, 0)), max: value })} placeholder="sem limite" />
      </div>
      <p className="hint">Buscando <strong>{rangeLabel(min, max)}</strong>. Limites exclusivos: o preço precisa ser maior que o mínimo e menor que o máximo.</p>
    </div>
  );
}
