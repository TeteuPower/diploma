import { Router } from 'express';
import * as nav from '../navegador';

export const debugRouter = Router();

/**
 * O que o agente enxerga AGORA, cru.
 *
 * Existe para desenvolvimento: quando ele diz "não acho o botão", esta rota
 * responde se o botão está no instantâneo ou não — sem precisar reproduzir a
 * sessão inteira. É leitura pura: não clica, não navega, só coleta a página que
 * já está aberta.
 */
debugRouter.get('/instantaneo', async (req, res) => {
  if (!nav.estaAberto()) {
    return res.status(409).type('text/plain').send('navegador fechado');
  }
  try {
    const linhas = Number(req.query.linhas) || 400;
    res.type('text/plain').send(await nav.instantaneo(linhas));
  } catch (err) {
    res.status(500).type('text/plain').send(err instanceof Error ? err.message : String(err));
  }
});

/** A URL aberta agora, sem carregar o instantâneo inteiro. */
debugRouter.get('/url', (_req, res) => res.type('text/plain').send(nav.urlAtual() ?? ''));
