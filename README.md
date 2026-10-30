# otrec — Next.js/Vercel

Aplicação React com Next.js que consulta oito marketplaces. Amazon Brasil, KaBuM!, AliExpress e Americanas têm coleta integrada de produtos; Mercado Livre, Shopee, Magalu e Casas Bahia ficam disponíveis somente por links de busca externa. A interface recebe os produtos coletados progressivamente por streaming e pode ser publicada na Vercel.

## Marketplaces

| Marketplace | Leitura | Categorias | Faixa de preço |
|---|---|---|---|
| Amazon | HTML dos cards | 23 departamentos (`search-alias` do próprio site, parâmetro `i`) | `rh=p_36:` na URL |
| KaBuM! | JSON `__NEXT_DATA__` | 15 departamentos, filtrados pelo departamento do produto | `facet_filters` (base64) na URL final, depois do redirecionamento da busca |
| Mercado Livre | Link externo | Todas | Segmento `PriceRange` na URL |
| Shopee | Link externo | Todas | `PRICE_RANGE` em `fe_filter_options` |
| AliExpress | JSON estruturado embutido no HTML | Todas | Corte exato feito localmente; a URL solicita frete grátis, origem BR e nota 4+ |
| Magalu | Link externo | Todas | `filters=price---...` |
| Casas Bahia | Link externo | Todas | `filter=preco-...` |
| Americanas | JSON do HTML ou consulta pública GraphQL usada pela busca do site | Todas | Faceta `price` na consulta e corte exato local |

Mercado Livre, Shopee, Magalu e Casas Bahia podem ser selecionados, mas seus produtos ainda não são agregados na lista interna. Selecioná-los prepara links de busca externa. O AliExpress expõe no HTML um JSON estruturado com preço, nota, vendidos e origem de envio. A Americanas usa uma consulta pública GraphQL; o identificador atual da consulta é lido do JavaScript público da loja, sem executar código remoto e sem fixar um hash que ficaria desatualizado. O catálogo e os geradores de URL ficam em `lib/marketplaces.js`.

Todos os marketplaces da busca concluída aparecem no filtro por loja, mesmo com zero produtos. Ao selecionar uma loja, a interface explica se houve bloqueio, exclusão por faixa de preço, exclusão internacional, origem não confirmada ou se a loja só está disponível por link externo. Isso não implica que exista coleta integrada nos oito sites.

Com **Excluir compra internacional** marcado, o AliExpress exclui também anúncios sem origem confirmada. O parâmetro de envio do Brasil não garante que a loja respeite o filtro: o corte final usa a origem informada em cada produto. Para incluir produtos internacionais, desmarque a opção e execute a busca novamente.

Ao executar uma busca, a página também atualiza sua própria query string (`q`, `min`, `max`, `sites`, `pages`, `international` e categorias), permitindo salvar ou compartilhar a configuração. A chave `APP_TOKEN` e URLs personalizadas nunca são colocadas na URL.

Os links de busca aparecem assim que o termo e a faixa de preço são válidos. Os cartões das lojas também têm o link **Abrir busca**. Em opções avançadas, é possível colar até oito URLs de busca de qualquer marketplace listado; filtros das URLs personalizadas são preservados. Uma URL inválida gera um aviso e é ignorada, sem cancelar a coleta das outras fontes. Sites sem coletor ficam disponíveis por link externo, sem envio dessas URLs ao servidor para download.

As URLs extras sempre funcionam como modelos de filtros: o termo antigo é substituído pelo nome atual. Por exemplo, trocar “fone de ouvido” por “poco x7 pro” atualiza as oito lojas e as URLs extras, mantendo preço, frete e avaliação compatíveis. Na Americanas, categorias fixas de fones são removidas para permitir a busca de outro tipo de produto. Sem um nome digitado, o app usa o termo original da URL.

## Executar localmente

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

O header inclui a música **funk do Otrec**, em `public/audio/o-rs-certo.mp3`, com onda animada, botão de reproduzir/pausar e botão de volume com ajuste de 0 a 100%. O volume inicial é 10%. A reprodução em loop é solicitada ao abrir a página; quando o navegador bloqueia áudio automático, o player tenta iniciar na primeira interação ou pelo botão de play. Pausar impede novas tentativas automáticas durante a visita. A animação respeita a preferência de movimento reduzido.

## Verificação

```bash
npm test
npm run build
npm run test:e2e
```

Os testes de navegador usam o Chrome instalado e simulam as respostas das lojas para reproduzir bloqueios e erros de forma determinística. Para outro navegador instalado, defina `PLAYWRIGHT_CHANNEL` (por exemplo, `msedge`). Para testar a coleta real no PowerShell, depois do build:

```powershell
$env:RUN_LIVE_SEARCH = '1'
node ./node_modules/@playwright/test/cli.js test --grep 'coleta real'
```

O teste real não exige uma quantidade fixa de produtos: lojas podem bloquear a coleta ou não ter ofertas no intervalo. A verificação cobre HTTP 200 da API, conclusão da busca, estados individuais das fontes e disponibilidade dos links externos.

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

- Até 4 marketplaces com coleta integrada, 4 marketplaces somente por links externos e 8 URLs próprias dos marketplaces listados; até 100 páginas por busca e 3 buscas simultâneas.
- `vercel.json` fixa a função na região `gru1` (São Paulo) para que os marketplaces vejam um acesso brasileiro.
- A função encerra a coleta com resultados parciais antes do limite de execução da Vercel.
- Resultados existem somente no navegador e devem ser exportados antes de fechar a página.
- Atualizar a página ou interromper a conexão cancela o acompanhamento da coleta.
- CAPTCHA, login, bloqueios por IP, renderização por JavaScript e alterações no HTML dos marketplaces podem impedir a coleta.
- A hospedagem na Vercel não garante que Amazon, KaBuM!, AliExpress ou Americanas aceitarão requisições originadas do datacenter. A consulta pública da Americanas é uma integração não oficial e alterações no site podem interrompê-la.

## Critérios

- Preço estritamente maior que o mínimo e menor que o máximo.
- Exclusão opcional de indicação internacional por texto, atributos ou selo Amazon `11tVhj88LYL`.
- Deduplicação por marketplace e identificador.
- Ordenação por ordem da coleta, menor/maior preço, maior desconto, melhor avaliação e mais avaliações.
- Refino depois da coleta: histograma de preços com faixa ajustável, filtro por marketplace e por nome.
- Exportação JSON e CSV dos resultados coletados.

Os arquivos Python e a pasta `static/` permanecem apenas como referência da implementação local anterior e não são usados pelo Next.js nem pela Vercel.
