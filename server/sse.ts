import type { Response } from 'express';
import { sessaoEvents, listSessoes } from './store';
import type { Sessao, Achado, SessaoStreamEvent } from '../shared/types';

const clientes = new Set<Response>();

function escrever(res: Response, evento: SessaoStreamEvent): void {
  res.write(`data: ${JSON.stringify(evento)}\n\n`);
}

/** Abre o stream ao vivo para um cliente do painel. */
export function adicionarCliente(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  clientes.add(res);
  // Snapshot inicial: o cliente já desenha tudo sem esperar o próximo evento.
  escrever(res, { type: 'snapshot', sessoes: listSessoes() });

  const ping = setInterval(() => {
    try {
      escrever(res, { type: 'ping' });
    } catch {
      /* ignora */
    }
  }, 20_000);

  res.on('close', () => {
    clearInterval(ping);
    clientes.delete(res);
  });
}

function difundir(evento: SessaoStreamEvent): void {
  for (const res of clientes) {
    try {
      escrever(res, evento);
    } catch {
      clientes.delete(res);
    }
  }
}

sessaoEvents.on('sessao', (s: Sessao) => difundir({ type: 'sessao', sessao: s }));
sessaoEvents.on('removida', (id: string) => difundir({ type: 'removida', id }));
// Achado novo chega ao vivo na página Achados, pelo mesmo cano das sessões.
sessaoEvents.on('achado', (a: Achado) => difundir({ type: 'achado', achado: a }));
