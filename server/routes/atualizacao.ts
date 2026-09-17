import { Router } from 'express';
import * as atualizacao from '../atualizacao';

export const atualizacaoRouter = Router();

/** Versão atual, se está instalado, o que há de novo e o andamento de um update. */
atualizacaoRouter.get('/', (_req, res) => res.json(atualizacao.estado()));

/** Consulta o GitHub agora, ignorando o intervalo de 6 h. */
atualizacaoRouter.post('/verificar', async (_req, res) => {
  const info = await atualizacao.verificar(true);
  res.json({ ...atualizacao.estado(), disponivel: info });
});

/**
 * Baixa e dispara o instalador. Responde quando o download começou; o
 * progresso vem pelo GET. Se der certo, este servidor é encerrado pelo
 * instalador — o cliente deve tratar a queda da conexão como sucesso.
 */
atualizacaoRouter.post('/instalar', async (_req, res) => {
  const r = await atualizacao.baixarEInstalar();
  res.status(r.ok ? 202 : 409).json(r);
});
