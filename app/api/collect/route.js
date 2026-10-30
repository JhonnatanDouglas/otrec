import { timingSafeEqual } from 'node:crypto';
import { collectProducts, configuration } from '../../../lib/collector.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request) {
  const expected = process.env.APP_TOKEN;
  if (!expected) return true;
  const received = request.headers.get('x-app-token') || '';
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function POST(request) {
  if (!authorized(request)) {
    return Response.json({ erro: 'Chave de acesso incorreta.' }, { status: 401 });
  }

  let config;
  try {
    config = configuration(await request.json());
  } catch (error) {
    return Response.json({ erro: error.message }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const workController = new AbortController();
  const signal = AbortSignal.any([request.signal, workController.signal]);
  const stream = new ReadableStream({
    async start(controller) {
      const send = (type, data) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify({ type, data })}\n`));
        } catch {
          // O navegador pode ter cancelado a leitura.
        }
      };
      try {
        const result = await collectProducts(config, {
          signal,
          onUpdate: snapshot => send('snapshot', snapshot),
        });
        send('snapshot', result);
      } catch (error) {
        if (error.name !== 'AbortError') send('error', { mensagem: error.message });
      } finally {
        try { controller.close(); } catch { /* stream já cancelado */ }
      }
    },
    cancel() { workController.abort(); },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
