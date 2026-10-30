import threading
import unittest
import urllib.error
from unittest.mock import Mock, patch
from collector import Job, extract, fetch, price, retry_after_seconds, validate_url
from server import configuration


def card(asin, value, extra=''):
    return f'<div data-component-type="s-search-result" data-asin="{asin}"><h2>Fone {asin}</h2><span class="a-price"><span class="a-offscreen">R$ {value}</span></span>{extra}</div>'


class CollectorTests(unittest.TestCase):
    def test_price(self):
        self.assertEqual(price('R$ 1.234,56'), 1234.56)
        self.assertIsNone(price(''))
        self.assertIsNone(price('indisponível'))

    def test_retry_after(self):
        self.assertEqual(retry_after_seconds('12'), 12)
        self.assertEqual(retry_after_seconds('Thu, 01 Jan 1970 00:00:20 GMT', now=10), 10)
        self.assertIsNone(retry_after_seconds('120'))
        self.assertIsNone(retry_after_seconds('inválido'))

    def test_fetch_retries_http_503(self):
        error = urllib.error.HTTPError('https://www.amazon.com.br/s', 503, 'Unavailable', {'Retry-After': '0'}, None)
        opener = Mock()
        opener.open.side_effect = [error, error, error, error]
        stop = Mock()
        stop.is_set.return_value = False
        stop.wait.return_value = False
        with patch('collector.urllib.request.build_opener', return_value=opener):
            with self.assertRaisesRegex(ValueError, 'persistiu após novas tentativas'):
                fetch('https://www.amazon.com.br/s', stop)
        self.assertEqual(opener.open.call_count, 4)
        self.assertEqual(stop.wait.call_count, 3)

    def test_urls(self):
        for url in ['http://www.amazon.com.br', 'https://localhost/', 'https://www.amazon.com.br.evil.test', 'https://user@www.amazon.com.br', 'https://www.amazon.com.br:444']:
            with self.assertRaises(ValueError): validate_url(url)
        self.assertEqual(validate_url('https://www.amazon.com.br/s?k=x#foo'), 'https://www.amazon.com.br/s?k=x')

    def test_filters_dedup_pagination(self):
        first = card('A', '180,50') + card('B', '170,00') + card('C', '200,00') + card('D', '185,00', '<img src="11tVhj88LYL.jpg">') + '<a class="s-pagination-next" href="/s?page=2">Próximo</a>'
        second = card('A', '180,50') + card('E', '190,00')
        config=configuration({'urls':['https://www.amazon.com.br/s?k=x']})
        job=Job(config)
        with patch('collector.fetch', side_effect=[first, second]) as fetch:
            job.run()
        result=job.snapshot()
        self.assertEqual(result['status'], 'concluido')
        self.assertEqual(fetch.call_count, 2)
        self.assertEqual([p['id'] for p in result['produtos']], ['A','E'])
        self.assertEqual(result['descartadosInternacionais'], 1)
        self.assertEqual(result['descartadosPreco'], 2)
        self.assertEqual(result['duplicados'], 1)

    def test_marketplace(self):
        source='<li class="ui-search-layout__item"><a class="poly-component__title" href="https://produto.mercadolivre.com.br/MLB-123-abc">Fone</a><div class="poly-price__current"><span class="andes-money-amount__fraction">185</span><span class="andes-money-amount__cents">90</span></div><span aria-label="Compra internacional"></span></li>'
        products, nxt=extract(source,'https://lista.mercadolivre.com.br/fone',1)
        self.assertEqual(products[0]['preco'],185.90)
        self.assertTrue(products[0]['internacional'])
        self.assertEqual(products[0]['id'],'MLB123')
        self.assertIsNone(nxt)

    def test_captcha(self):
        with self.assertRaisesRegex(ValueError, 'verificação humana'):
            extract('<title>Robot Check</title>', 'https://www.amazon.com.br', 1)

    def test_invalid_configuration(self):
        for data in [{'min':200,'max':170},{'min':float('nan')},{'pages':401},{'concurrency':4}]:
            with self.assertRaises(ValueError):configuration({'urls':['https://www.amazon.com.br/s'],**data})

    def test_cancel(self):
        job=Job(configuration({'urls':['https://www.amazon.com.br/s']}))
        job.stop.set()
        with patch('collector.fetch') as fetch: job.run()
        fetch.assert_not_called()
        self.assertEqual(job.snapshot()['status'],'cancelado')

    def test_partial_results(self):
        job=Job(configuration({'urls':['https://www.amazon.com.br/s']}))
        with patch('collector.fetch', side_effect=[card('A','180,00')+'<a class="s-pagination-next" href="/s?page=2">Next</a>', ValueError('HTTP 403')]):job.run()
        self.assertEqual(len(job.snapshot()['produtos']),1)
        self.assertEqual(job.snapshot()['status'],'concluido_com_avisos')


if __name__ == '__main__': unittest.main()
