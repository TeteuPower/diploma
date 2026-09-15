import { Router } from 'express';
import { listSessoes, getSessao, deleteSessao } from '../store';
import { criarSessao, executar, abortar, estaRodando } from '../agente';
import { responder } from '../aprovacao';
import { adicionarCliente } from '../sse';
import * as nav from '../navegador';

export const sessoesRouter = Router();

// O stream vem antes de /:id para não ser capturado pelo parâmetro.
sessoesRouter.get('/stream', (_req, res) => adicionarCliente(res));

sessoesRouter.get('/', (_req, res) => res.json(listSessoes()));

sessoesRouter.get('/:id', (req, res) => {
  const s = getSessao(req.params.id);
  if (!s) return res.status(404).json({ error: 'sessão não encontrada' });
  res.json(s);
});

/** Cria e já dispara. A resposta volta na hora; o progresso chega por SSE. */
sessoesRouter.post('/', async (req, res) => {
  const { objetivo } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof objetivo !== 'string' || !objetivo.trim()) {
    return res.status(400).json({ error: 'objetivo é obrigatório' });
  }
  const sessao = await criarSessao(objetivo.slice(0, 4000));
  executar(sessao.id);
  res.status(201).json(sessao);
});

/** Retoma uma sessão parada, de onde ela ficou (resume do session_id do SDK). */
sessoesRouter.post('/:id/retomar', (req, res) => {
  const s = getSessao(req.params.id);
  if (!s) return res.status(404).json({ error: 'sessão não encontrada' });
  if (estaRodando(s.id)) return res.status(409).json({ error: 'a sessão já está rodando' });
  executar(s.id);
  res.json({ ok: true });
});

sessoesRouter.post('/:id/parar', (req, res) => {
  res.json({ ok: abortar(req.params.id) });
});

/** A ponta da UI do portão: destrava a ferramenta que está esperando. */
sessoesRouter.post('/:id/aprovacao', async (req, res) => {
  const { pedidoId, aprovado, motivo } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof pedidoId !== 'string') {
    return res.status(400).json({ error: 'pedidoId é obrigatório' });
  }
  const ok = await responder(
    req.params.id,
    pedidoId,
    Boolean(aprovado),
    typeof motivo === 'string' ? motivo.slice(0, 1000) : '',
  );
  if (!ok) {
    return res.status(409).json({ error: 'esse pedido não está mais esperando resposta' });
  }
  res.json({ ok: true });
});

sessoesRouter.delete('/:id', async (req, res) => {
  abortar(req.params.id);
  const ok = await deleteSessao(req.params.id);
  if (!ok) return res.status(404).json({ error: 'sessão não encontrada' });
  res.status(204).end();
});

// --- Navegador (controle manual pelo painel) ---

sessoesRouter.post('/navegador/fechar', async (_req, res) => {
  await nav.fechar();
  res.json({ ok: true });
});
