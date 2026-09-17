import { Router } from 'express';
import * as brave from '../brave';
import { getConfig } from '../store';

export const braveRouter = Router();

/**
 * Nenhuma rota devolve a chave. O GET diz se existe; o POST recebe e cifra; o
 * DELETE apaga; o testar usa por dentro. Mesma disciplina do cofre.
 */

braveRouter.get('/', (_req, res) => {
  res.json({ configurada: brave.configurada(), pais: getConfig().brave.pais });
});

braveRouter.post('/chave', async (req, res) => {
  const { chave } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof chave !== 'string' || !chave.trim()) {
    return res.status(400).json({ error: 'chave é obrigatória' });
  }
  try {
    await brave.guardarChave(chave);
    res.status(201).json({ configurada: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

braveRouter.delete('/chave', async (_req, res) => {
  const ok = await brave.removerChave();
  if (!ok) return res.status(404).json({ error: 'nenhuma chave configurada' });
  res.status(204).end();
});

braveRouter.post('/testar', async (_req, res) => {
  res.json(await brave.testar());
});
