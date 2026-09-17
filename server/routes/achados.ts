import { Router } from 'express';
import { listar, remover } from '../achados';

export const achadosRouter = Router();

/** Todos, ou só os de uma sessão (`?sessao=ses-xxx`). */
achadosRouter.get('/', (req, res) => {
  const sessao = typeof req.query.sessao === 'string' ? req.query.sessao : undefined;
  res.json(listar(sessao));
});

/** O dono pode descartar um achado que julgou errado ou irrelevante. */
achadosRouter.delete('/:id', async (req, res) => {
  const ok = await remover(req.params.id);
  if (!ok) return res.status(404).json({ error: 'achado não encontrado' });
  res.status(204).end();
});
