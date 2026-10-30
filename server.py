import json
import math
import os
from pathlib import Path
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from collector import Job, validate_url

ROOT = Path(__file__).parent / 'static'
JOBS = {}
LOCK = threading.Lock()


def configuration(data):
    urls = data.get('urls', [])
    if not isinstance(urls, list) or not 1 <= len(urls) <= 10 or not all(isinstance(u, str) for u in urls):
        raise ValueError('Informe entre 1 e 10 URLs de busca.')
    urls = list(dict.fromkeys(validate_url(u) for u in urls))
    low, high = float(data.get('min', 170)), float(data.get('max', 200))
    pages, concurrency = int(data.get('pages', 20)), int(data.get('concurrency', 3))
    if not math.isfinite(low) or not math.isfinite(high) or not 0 <= low < high <= 10_000_000:
        raise ValueError('Informe preços válidos, com máximo maior que mínimo.')
    if not 1 <= pages <= 400 or not 1 <= concurrency <= 3:
        raise ValueError('Use de 1 a 400 páginas e de 1 a 3 buscas simultâneas.')
    if not isinstance(data.get('excludeInternational', True), bool):
        raise ValueError('Filtro internacional inválido.')
    return dict(urls=urls, min=low, max=high, pages=pages, concurrency=concurrency,
                excludeInternational=data.get('excludeInternational', True))


class Handler(BaseHTTPRequestHandler):
    def send(self, status, payload, content_type='application/json; charset=utf-8'):
        body = json.dumps(payload, ensure_ascii=False).encode() if isinstance(payload, dict) else payload
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; img-src 'self' https:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(body)

    def local_request(self):
        expected = f'127.0.0.1:{self.server.server_port}'
        hosts = {expected, f'localhost:{self.server.server_port}'}
        return self.headers.get('Host') in hosts and (not self.headers.get('Origin') or self.headers['Origin'] in {'http://' + h for h in hosts})

    def do_GET(self):
        if not self.local_request():
            return self.send(403, {'erro': 'Origem não permitida.'})
        path = urlsplit(self.path).path
        if path.startswith('/api/jobs/'):
            job = JOBS.get(path.rsplit('/', 1)[-1])
            return self.send(200, job.snapshot()) if job else self.send(404, {'erro': 'Coleta não encontrada. O servidor pode ter reiniciado.'})
        assets = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript; charset=utf-8'), '/style.css': ('style.css', 'text/css; charset=utf-8')}
        if path not in assets:
            return self.send(404, {'erro': 'Não encontrado.'})
        file, mime = assets[path]
        self.send(200, (ROOT / file).read_bytes(), mime)

    def do_POST(self):
        if not self.local_request() or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.send(403, {'erro': 'Requisição não permitida.'})
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size <= 32_000:
                raise ValueError('Corpo da requisição inválido.')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('Esperado um objeto JSON.')
            if self.path == '/api/jobs':
                config = configuration(data)
                with LOCK:
                    if any(j.state == 'executando' for j in JOBS.values()):
                        return self.send(409, {'erro': 'Já existe uma coleta em andamento. Aguarde ou cancele.'})
                    while len(JOBS) >= 20:
                        del JOBS[next(iter(JOBS))]
                    key = secrets.token_urlsafe(16)
                    job = JOBS[key] = Job(config)
                    threading.Thread(target=job.run, daemon=True).start()
                return self.send(201, {'id': key})
            if self.path.startswith('/api/jobs/') and self.path.endswith('/cancel'):
                job = JOBS.get(self.path.split('/')[3])
                if not job:
                    return self.send(404, {'erro': 'Coleta não encontrada.'})
                job.stop.set()
                return self.send(200, {'ok': True})
            self.send(404, {'erro': 'Não encontrado.'})
        except (ValueError, TypeError, OverflowError) as error:
            self.send(400, {'erro': str(error)})


if __name__ == '__main__':
    port = int(os.environ.get('PORT', '8765'))
    print(f'otrec disponível em http://127.0.0.1:{port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
