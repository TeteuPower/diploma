import { Router } from 'express';
import { listar, marcarDesfeita } from '../mudancas';

export const mudancasRouter = Router();

/** O diário do que o agente mexeu no PC — a mais recente primeiro. */
mudancasRouter.get('/', (_req, res) => res.json(listar()));

/** O dono rodou o comando de volta e marca a mudança como desfeita. */
mudancasRouter.post('/:id/desfeita', async (req, res) => {
  const ok = await marcarDesfeita(req.params.id);
  if (!ok) return res.status(404).json({ error: 'mudança não encontrada ou já desfeita' });
  res.json({ ok: true });
});
