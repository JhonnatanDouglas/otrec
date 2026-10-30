import { createSession } from 'wreq-js';
import * as cheerio from 'cheerio';

const session = await createSession({ browser: 'chrome_149', os: 'windows' });
try {
  for (const candidate of [
    'https://busca-autocomplete-prd.casasbahia.com.br/api/v1?query=fone',
    'https://busca-autocomplete-prd.casasbahia.com.br/api/v1?term=fone',
    'https://busca-autocomplete-prd.casasbahia.com.br/api/v1?q=fone',
    'https://busca-autocomplete-prd.casasbahia.com.br/api/v1/fone',
  ]) {
    const candidateResponse = await session.fetch(candidate, { headers: { Referer: 'https://www.casasbahia.com.br/' } });
    const candidateBody = await candidateResponse.text();
    console.log(JSON.stringify({ candidate, status: candidateResponse.status, length: candidateBody.length, head: candidateBody.slice(0, 500) }));
  }
  for (const url of ['https://www.casasbahia.com.br/', 'https://www.casasbahia.com.br/fone/b?filter=preco-170to200']) {
    const response = await session.fetch(url, { headers: { 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' }, redirect: 'follow' });
    const content = await response.text();
    console.log(JSON.stringify({ url, status: response.status, length: content.length,
      prices: (content.match(/R\$\s*[\d.]+(?:,\d{2})?/g) || []).length,
      productLinks: (content.match(/\/p\/?/g) || []).length,
      head: content.replace(/\s+/g, ' ').slice(0, 220) }));
    if (url.endsWith('/')) {
      const $ = cheerio.load(content);
      const scripts = $('script[src]').toArray().map(node => $(node).attr('src')).filter(src => /_next/i.test(src || ''));
      console.log(JSON.stringify({
        nextData: $('script#__NEXT_DATA__').text().slice(0, 500),
        scripts: scripts.slice(-30),
        apiStrings: [...new Set((content.match(/https?:[^"'\\\s<]{5,200}|\/(?:api|_next)[^"'\\\s<]{5,200}/gi) || []).filter(value => /search|graphql|catalog|product/i.test(value)))].slice(0, 30),
      }));
      for (const src of scripts) {
        const scriptResponse = await session.fetch(new URL(src, url).href);
        const script = await scriptResponse.text();
        const matches = [...new Set((script.match(/https?:[^"'`\\\s]{5,250}|\/(?:api|services|search|busca)[^"'`\\\s]{5,250}/gi) || []).filter(value => /search|busca|catalog|product|graphql|api/i.test(value)))];
        if (matches.length) console.log(JSON.stringify({ src, status: scriptResponse.status, matches: matches.slice(0, 50) }));
        const autocomplete = script.indexOf('busca-autocomplete-prd.casasbahia.com.br');
        if (autocomplete >= 0) console.log(JSON.stringify({ src, autocompleteContext: script.slice(Math.max(0, autocomplete - 1500), autocomplete + 2500) }));
      }
    }
  }
} finally {
  await session.close();
}
