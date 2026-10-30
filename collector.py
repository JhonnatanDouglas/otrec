"""Coleta limitada a marketplaces brasileiros, sem dependências externas."""
import concurrent.futures
import email.utils
import html.parser
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

HOSTS = {'www.amazon.com.br': 'Amazon', 'amazon.com.br': 'Amazon',
         'lista.mercadolivre.com.br': 'Mercado Livre', 'www.mercadolivre.com.br': 'Mercado Livre',
         'produto.mercadolivre.com.br': 'Mercado Livre'}
INTERNATIONAL = re.compile(r'11tVhj88LYL|compra\s+internacional|envio\s+internacional|enviado\s+do\s+exterior', re.I)
MAX_RETRY_AFTER = 60


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    @property
    def text(self):
        return ' '.join(c if isinstance(c, str) else c.text for c in self.children).strip()

    def find(self, predicate):
        for child in self.children:
            if isinstance(child, Node):
                if predicate(child):
                    yield child
                yield from child.find(predicate)

    def first(self, predicate):
        return next(self.find(predicate), None)

    def has(self, cls):
        return cls in self.attrs.get('class', '').split()


class Document(html.parser.HTMLParser):
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'}

    def __init__(self, source):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        if tag not in self.VOID:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                del self.stack[i:]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def price(text):
    value = re.sub(r'[^\d,.]', '', text or '')
    if not value:
        return None
    try:
        return float(value.replace('.', '').replace(',', '.'))
    except ValueError:
        return None


def validate_url(raw):
    url = urllib.parse.urlsplit(raw.strip())
    if url.scheme != 'https' or url.hostname not in HOSTS or url.username or url.password or url.port not in (None, 443):
        raise ValueError('Use uma URL HTTPS da Amazon Brasil ou do Mercado Livre Brasil.')
    return urllib.parse.urlunsplit((url.scheme, url.netloc, url.path or '/', url.query, ''))


def extract(source, url, page):
    doc = Document(source).root
    title = doc.first(lambda n: n.tag == 'title')
    if (title and re.search(r'captcha|robot check|verifica|access denied', title.text, re.I)) or doc.first(lambda n: 'validateCaptcha' in n.attrs.get('action', '')):
        raise ValueError('O marketplace solicitou verificação humana. Coleta interrompida.')
    amazon = 'amazon.com.br' in urllib.parse.urlsplit(url).hostname
    cards = list(doc.find(lambda n: n.attrs.get('data-component-type') == 's-search-result' and n.attrs.get('data-asin'))) if amazon else list(doc.find(lambda n: n.has('ui-search-layout__item')))
    products = []
    for index, card in enumerate(cards):
        attributes = ' '.join(' '.join(n.attrs.values()) for n in [card, *card.find(lambda n: True)])
        international = bool(INTERNATIONAL.search(card.text + ' ' + attributes))
        if amazon:
            product_id = card.attrs['data-asin']
            name = card.first(lambda n: n.tag == 'h2')
            block = card.first(lambda n: n.has('a-price') and not n.has('a-text-price'))
            amount = block.first(lambda n: n.has('a-offscreen')) if block else None
            amount = price(amount.text) if amount else None
            rating = card.first(lambda n: n.has('a-icon-alt'))
            reviews = card.first(lambda n: n.has('s-underline-text') and n.has('a-size-base'))
            picture = card.first(lambda n: n.tag == 'img' and n.has('s-image'))
            link = f'https://www.amazon.com.br/dp/{product_id}'
        else:
            name = card.first(lambda n: n.has('poly-component__title') or n.has('ui-search-item__title'))
            anchor = name if name and name.tag == 'a' else card.first(lambda n: n.tag == 'a' and n.attrs.get('href'))
            link = urllib.parse.urljoin(url, anchor.attrs.get('href', '')) if anchor else ''
            match = re.search(r'MLB-?(\d+)', link)
            product_id = 'MLB' + match[1] if match else link.split('?')[0]
            block = card.first(lambda n: n.has('poly-price__current') or n.has('ui-search-price__second-line')) or card
            fraction = block.first(lambda n: n.has('andes-money-amount__fraction'))
            cents = block.first(lambda n: n.has('andes-money-amount__cents'))
            amount = price(fraction.text + (',' + cents.text if cents else '')) if fraction else None
            rating = card.first(lambda n: n.has('poly-reviews__rating') or n.has('ui-search-reviews__rating-number'))
            reviews = card.first(lambda n: n.has('poly-reviews__total') or n.has('ui-search-reviews__amount'))
            picture = card.first(lambda n: n.tag == 'img')
        if not product_id:
            continue
        score = re.search(r'\d+(?:[,.]\d+)?', rating.text) if rating else None
        products.append(dict(id=product_id, nome=name.text if name else 'Produto sem título', preco=amount,
            avaliacao=float(score[0].replace(',', '.')) if score else None,
            quantidadeAvaliacoes=int(re.sub(r'\D', '', reviews.text) or '0') if reviews else None,
            imagem=(picture.attrs.get('src') or picture.attrs.get('data-src')) if picture else None,
            link=link, pagina=page, posicao=index + 1, marketplace='Amazon' if amazon else 'Mercado Livre',
            internacional=international))
    nxt = doc.first(lambda n: n.tag == 'a' and (n.has('s-pagination-next') or n.attrs.get('title') == 'Seguinte' or n.attrs.get('aria-label') in ('Seguinte', 'Próxima')))
    if not nxt and not amazon:
        li = doc.first(lambda n: n.has('andes-pagination__button--next') and not n.has('andes-pagination__button--disabled'))
        nxt = li.first(lambda n: n.tag == 'a') if li else None
    next_url = urllib.parse.urljoin(url, nxt.attrs['href']) if nxt and nxt.attrs.get('href') else None
    return products, next_url


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def retry_after_seconds(value, now=None):
    """Converte Retry-After em segundos, recusando esperas excessivas."""
    if not value:
        return None
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        try:
            target = email.utils.parsedate_to_datetime(value)
            seconds = round(target.timestamp() - (time.time() if now is None else now))
        except (TypeError, ValueError, OverflowError):
            return None
    return max(0, seconds) if seconds <= MAX_RETRY_AFTER else None


def fetch(url, stop):
    opener = urllib.request.build_opener(SafeRedirect())
    attempts = 4
    for attempt in range(attempts):
        if stop.is_set():
            raise InterruptedError()
        try:
            request = urllib.request.Request(validate_url(url), headers={'User-Agent': 'Mozilla/5.0 (compatible; ProductResearch/1.0)', 'Accept-Language': 'pt-BR,pt;q=0.9'})
            with opener.open(request, timeout=20) as response:
                if 'html' not in response.headers.get('Content-Type', ''):
                    raise ValueError('O endereço não retornou uma página HTML.')
                data = response.read(6_000_001)
                if len(data) > 6_000_000:
                    raise ValueError('Página excedeu o limite de 6 MB.')
                return data.decode(response.headers.get_content_charset() or 'utf-8', errors='replace')
        except urllib.error.HTTPError as error:
            if error.code in (403, 429):
                raise ValueError(f'Marketplace bloqueou a coleta (HTTP {error.code}). Tente novamente mais tarde.') from error
            if error.code < 500 or attempt == attempts - 1:
                detail = ' A indisponibilidade persistiu após novas tentativas.' if error.code == 503 else ''
                raise ValueError(f'Falha HTTP {error.code} ao coletar a página.{detail}') from error
            retry_after = retry_after_seconds(error.headers.get('Retry-After'))
            delay = retry_after if retry_after is not None else 2 ** (attempt + 1)
        except (TimeoutError, urllib.error.URLError):
            if attempt == attempts - 1:
                raise ValueError(f'Não foi possível acessar o marketplace após {attempts} tentativas.')
            delay = 2 ** (attempt + 1)
        if stop.wait(delay):
            raise InterruptedError()


class Job:
    def __init__(self, config):
        self.config = config
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.state = 'executando'
        self.products, self.seen, self.errors, self.events = {}, set(), [], []
        self.pages = self.international = self.outside = self.duplicates = 0
        self.started = time.time()

    def snapshot(self):
        with self.lock:
            return dict(status=self.state, filtros=self.config, paginasColetadas=self.pages,
                descartadosInternacionais=self.international, descartadosPreco=self.outside,
                duplicados=self.duplicates, erros=list(self.errors), eventos=list(self.events[-30:]),
                produtos=list(self.products.values()), duracao=round(time.time() - self.started))

    def collect(self, url):
        visited = set()
        if 'amazon.com.br' in urllib.parse.urlsplit(url).hostname:
            parsed = urllib.parse.urlsplit(url)
            query = urllib.parse.parse_qs(parsed.query)
            filters = [f for f in query.get('rh', [''])[0].split(',') if f and not f.startswith('p_36:')]
            filters.append(f"p_36:{round(self.config['min'] * 100)}-{round(self.config['max'] * 100)}")
            query['rh'] = [','.join(filters)]
            url = urllib.parse.urlunsplit(parsed._replace(query=urllib.parse.urlencode(query, doseq=True)))
        try:
            for page in range(1, self.config['pages'] + 1):
                if self.stop.is_set() or url in visited:
                    break
                visited.add(url)
                products, next_url = extract(fetch(url, self.stop), url, page)
                with self.lock:
                    self.pages += 1
                    for product in products:
                        key = product['marketplace'] + ':' + product['id']
                        if key in self.seen:
                            self.duplicates += 1
                            continue
                        self.seen.add(key)
                        if self.config['excludeInternational'] and product['internacional']:
                            self.international += 1
                        elif product['preco'] is None or not self.config['min'] < product['preco'] < self.config['max']:
                            self.outside += 1
                        else:
                            self.products[key] = product
                    self.events.append(f"{HOSTS[urllib.parse.urlsplit(url).hostname]} · página {page}: {len(products)} anúncios lidos")
                if not products:
                    raise ValueError('Nenhum anúncio reconhecido. Use uma URL de busca/listagem; a página pode exigir JavaScript ou ter mudado de estrutura.')
                if not next_url:
                    break
                next_url = validate_url(next_url)
                if HOSTS[urllib.parse.urlsplit(next_url).hostname] != HOSTS[urllib.parse.urlsplit(url).hostname]:
                    raise ValueError('Paginação apontou para outro marketplace.')
                url = next_url
                # A Amazon tende a devolver 503 em paginações longas e muito rápidas.
                delay = 2 if 'amazon.com.br' in urllib.parse.urlsplit(url).hostname else 1
                if self.stop.wait(delay):
                    break
        except InterruptedError:
            pass
        except Exception as error:
            with self.lock:
                self.errors.append({'url': url, 'mensagem': str(error)})

    def run(self):
        try:
            with concurrent.futures.ThreadPoolExecutor(max_workers=self.config['concurrency']) as pool:
                list(pool.map(self.collect, self.config['urls']))
        finally:
            with self.lock:
                self.state = 'cancelado' if self.stop.is_set() else ('concluido_com_avisos' if self.errors else 'concluido')
