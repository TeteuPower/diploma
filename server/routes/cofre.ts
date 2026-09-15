import { Router } from 'express';
import * as cofre from '../cofre';

export const cofreRouter = Router();

/**
 * Note o que NÃO existe aqui: nenhuma rota devolve senha. O GET traz metadados,
 * o POST recebe e cifra, o DELETE apaga. `revelarParaNavegador` fica fora do
 * alcance do HTTP de propósito — só o Playwright a chama.
 */

cofreRouter.get('/', (_req, res) => res.json(cofre.estado()));

cofreRouter.post('/', async (req, res) => {
  const { dominio, usuario, senha, rotulo } = (req.body ?? {}) as Record<string, unknown>;

  if (typeof dominio !== 'string' || !dominio.trim()) {
    return res.status(400).json({ error: 'domínio é obrigatório' });
  }
  if (typeof usuario !== 'string' || !usuario.trim()) {
    return res.status(400).json({ error: 'usuário é obrigatório' });
  }
  if (typeof senha !== 'string' || !senha) {
    return res.status(400).json({ error: 'senha é obrigatória' });
  }

  try {
    const meta = await cofre.guardar({
      dominio,
      usuario,
      senha,
      rotulo: typeof rotulo === 'string' ? rotulo : undefined,
    });
    res.status(201).json(meta);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

cofreRouter.delete('/:id', async (req, res) => {
  const ok = await cofre.remover(req.params.id);
  if (!ok) return res.status(404).json({ error: 'credencial não encontrada' });
  res.status(204).end();
});
