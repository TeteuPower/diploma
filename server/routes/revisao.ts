import { Router } from 'express';
import { revisarEntregaveis, listar } from '../trabalhos';

export const revisaoRouter = Router();

/**
 * O que está pronto e o que ainda tem recado ao dono embutido.
 *
 * Existe porque o risco é assimétrico: um recado esquecido dentro do
 * entregável chega ao professor junto, e o dono não vai reler cada linha
 * antes de enviar. Melhor um alarme falso aqui do que um "confirme com o
 * grupo" na mão de quem corrige.
 */
revisaoRouter.get('/', async (_req, res) => {
  const [arquivos, suspeitas] = await Promise.all([listar(), revisarEntregaveis()]);
  res.json({ arquivos, suspeitas });
});
