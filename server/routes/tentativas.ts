import { Router } from 'express';
import { listar, esquecer } from '../tentativas';

export const tentativasRouter = Router();

/** O que já foi gasto, por quiz — auditoria do limite. */
tentativasRouter.get('/', (_req, res) => res.json(listar()));

/**
 * Zerar é decisão do dono: só ele sabe se a faculdade liberou mais tentativas,
 * ou se o registro pegou um falso positivo. O agente não tem esta rota.
 */
tentativasRouter.delete('/:quiz', async (req, res) => {
  const ok = await esquecer(decodeURIComponent(req.params.quiz));
  if (!ok) return res.status(404).json({ error: 'quiz não registrado' });
  res.status(204).end();
});
