# otrec — Next.js/Vercel

Aplicação React com Next.js que busca um produto ao mesmo tempo na **Amazon Brasil e no KaBuM!**, com categoria por marketplace e faixa de preço. A interface recebe resultados progressivamente por streaming e pode ser publicada no plano Hobby da Vercel.

## Marketplaces

| Marketplace | Leitura | Categorias | Faixa de preço |
|---|---|---|---|
| Amazon | HTML dos cards | 23 departamentos (`search-alias` do próprio site, parâmetro `i`) | `rh=p_36:` na URL |
| KaBuM! | JSON `__NEXT_DATA__` | 15 departamentos, filtrados pelo departamento do produto | `facet_filters` (base64) na URL final, depois do redirecionamento da busca |

Mercado Livre, AliExpress, Shopee, Magalu, Casas Bahia e Americanas aparecem desativados na interface: Mercado Livre e AliExpress exigem verificação de conta/captcha para acessos vindos de servidor, Shopee e Americanas dependem de JavaScript para listar produtos e Magalu e Casas Bahia bloqueiam acesso automatizado (HTTP 403). O catálogo fica em `lib/marketplaces.js`.

## Executar localmente

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

O header inclui a música **funk do Otrec**, em `public/audio/o-rs-certo.mp3`, com onda animada, botão de reproduzir/pausar e botão de volume com ajuste de 0 a 100%. O volume inicial é 50%. A reprodução em loop é solicitada ao abrir a página; quando o navegador bloqueia áudio automático, o player tenta iniciar na primeira interação ou pelo botão de play. Pausar impede novas tentativas automáticas durante a visita. A animação respeita a preferência de movimento reduzido.

## Verificação

```bash
npm test
npm run build
```

## Publicar diretamente na Vercel

Instale a CLI da Vercel, entre na sua conta e execute o deploy a partir desta pasta:

```bash
npm install -g vercel
vercel login
vercel
vercel --prod
```

Esses comandos enviam a pasta local diretamente para a Vercel; GitHub e Git não são necessários.

### Proteção recomendada

Crie no projeto da Vercel uma variável de ambiente chamada `APP_TOKEN`, com uma chave longa e aleatória. Informe a mesma chave no campo **Chave de acesso** da interface. Sem essa variável, qualquer visitante poderá iniciar coletas e consumir a cota gratuita.

## Limites da versão serverless

- Até 2 marketplaces + 3 URLs próprias da Amazon ou do KaBuM!, 100 páginas por busca e 3 buscas simultâneas.
- `vercel.json` fixa a função na região `gru1` (São Paulo) para que os marketplaces vejam um acesso brasileiro.
- A função encerra a coleta com resultados parciais antes do limite de execução da Vercel.
- Resultados existem somente no navegador e devem ser exportados antes de fechar a página.
- Atualizar a página ou interromper a conexão cancela o acompanhamento da coleta.
- CAPTCHA, login, bloqueios por IP, renderização por JavaScript e alterações no HTML dos marketplaces podem impedir a coleta.
- A hospedagem na Vercel não garante que Amazon ou KaBuM! aceitarão requisições originadas do datacenter.

## Critérios

- Preço estritamente maior que o mínimo e menor que o máximo.
- Exclusão opcional de indicação internacional por texto, atributos ou selo Amazon `11tVhj88LYL`.
- Deduplicação por marketplace e identificador.
- Ordenação por ordem da coleta, menor/maior preço, maior desconto, melhor avaliação e mais avaliações.
- Refino depois da coleta: histograma de preços com faixa ajustável, filtro por marketplace e por nome.
- Exportação JSON e CSV dos resultados coletados.

Os arquivos Python e a pasta `static/` permanecem apenas como referência da implementação local anterior e não são usados pelo Next.js nem pela Vercel.
