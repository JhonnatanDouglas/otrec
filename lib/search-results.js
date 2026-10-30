import { MARKETPLACES } from './marketplaces.js';

// A lista de lojas vem das fontes solicitadas, incluindo as que tiveram zero
// produtos. Contar apenas os cards fazia essas lojas desaparecerem da interface.
export function summarizeMarkets(snapshot) {
  const links = snapshot.links || [];
  const sources = snapshot.fontes || [];
  const products = snapshot.produtos || [];
  const ids = new Set([...links.map(link => link.marketplaceId), ...sources.map(source => source.marketplaceId), ...products.map(product => product.marketplaceId)]);
  return MARKETPLACES.filter(marketplace => ids.has(marketplace.id)).map(marketplace => {
    const ownSources = sources.filter(source => source.marketplaceId === marketplace.id);
    const count = products.filter(product => product.marketplaceId === marketplace.id).length;
    const sum = key => ownSources.reduce((total, source) => total + (Number(source[key]) || 0), 0);
    let message;
    if (!marketplace.collect) message = 'Esta loja ainda não tem coleta integrada de produtos. A busca está disponível no próprio site; seus produtos não entram nesta lista.';
    else if (ownSources.some(source => source.status === 'coletando' || source.status === 'na fila')) message = 'A coleta desta loja ainda está em andamento.';
    else if (!ownSources.length) message = 'A coleta desta loja ainda não foi iniciada.';
    else {
      const reasons = [];
      if (sum('descartadosInternacionais')) reasons.push(`${sum('descartadosInternacionais')} internacionais excluídos`);
      if (sum('descartadosOrigemDesconhecida')) reasons.push(`${sum('descartadosOrigemDesconhecida')} sem origem confirmada excluídos`);
      if (sum('descartadosPreco')) reasons.push(`${sum('descartadosPreco')} fora da faixa ou sem preço`);
      if (sum('descartadosCategoria')) reasons.push(`${sum('descartadosCategoria')} fora da categoria`);
      if (sum('duplicados')) reasons.push(`${sum('duplicados')} duplicados`);
      const errors = ownSources.filter(source => source.erro).map(source => source.erro);
      message = `${sum('anuncios')} anúncios lidos; ${count} produtos nesta lista.${reasons.length ? ` ${reasons.join('; ')}.` : ''}${errors.length ? ` Problema na coleta: ${[...new Set(errors)].join(' ')}` : ''}`;
    }
    return { marketplace, count, message, url: links.find(link => link.marketplaceId === marketplace.id)?.url || ownSources[0]?.url || null };
  });
}
