import { Router } from 'express';
import { montarPainel } from '../entrega';

export const entregaRouter = Router();

/** O painel de entrega, conferido no disco. Leitura pura. */
entregaRouter.get('/', async (_req, res) => {
  try {
    res.json(await montarPainel());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});
