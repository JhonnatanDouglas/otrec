const targets = {
  mercadolivre: 'https://lista.mercadolivre.com.br/fone_PriceRange_170BRL-200BRL',
  shopee: 'https://shopee.com.br/search?keyword=fone&page=0',
  magalu: 'https://www.magazineluiza.com.br/busca/fone/?page=1&filters=price---17000%3A20000',
  casasbahia: 'https://www.casasbahia.com.br/fone/b?filter=preco-170to200',
};

function translated(raw) {
  const source = new URL(raw);
  const host = source.hostname.replaceAll('-', '--').replaceAll('.', '-');
  const result = new URL(`https://${host}.translate.goog${source.pathname}${source.search}`);
  result.searchParams.set('_x_tr_sl', 'pt');
  result.searchParams.set('_x_tr_tl', 'en');
  result.searchParams.set('_x_tr_hl', 'en');
  return result.href;
}

const methods = {
  corsdev: raw => `https://proxy.cors.dev/${raw}`,
  allorigins: raw => `https://api.allorigins.win/raw?url=${encodeURIComponent(raw)}`,
  translate: translated,
};

await Promise.all(Object.entries(targets).flatMap(([marketplace, target]) => Object.entries(methods).map(async ([method, wrap]) => {
  const started = Date.now();
  try {
    const response = await fetch(wrap(target), { signal: AbortSignal.timeout(45_000), headers: { Origin: 'https://example.com', 'User-Agent': 'Mozilla/5.0' } });
    const content = await response.text();
    console.log(JSON.stringify({ marketplace, method, status: response.status, length: content.length,
      prices: (content.match(/R\$\s*[\d.]+(?:,\d{2})?/g) || []).length,
      productLinks: (content.match(/(?:\/p\/|\/produto\/|-i\.\d+\.\d+)/g) || []).length,
      elapsed: Date.now() - started, head: content.replace(/\s+/g, ' ').slice(0, 180) }));
  } catch (error) {
    console.log(JSON.stringify({ marketplace, method, error: error.message, elapsed: Date.now() - started }));
  }
})));
