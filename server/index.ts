import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PORT, WEB_DIST, PROJECT_ROOT, HOME, VERSION, INSTALADO, modoTravadoPorEnv, hasApiKeyEnv } from './env';
import { spawn } from 'node:child_process';
import { verificar as verificarAtualizacao } from './atualizacao';
import { initStore, recuperarOrfas, getConfig } from './store';
import { initCofre, disponivel as cofreDisponivel, total as totalCredenciais } from './cofre';
import { limparPendentes } from './aprovacao';
import { initTentativas } from './tentativas';
import { initTrabalhos } from './trabalhos';
import { initAchados } from './achados';
import * as nav from './navegador';
import './sse';
import { configRouter } from './routes/config';
import { cofreRouter } from './routes/cofre';
import { sessoesRouter } from './routes/sessoes';
import { tentativasRouter } from './routes/tentativas';
import { debugRouter } from './routes/debug';
import { revisaoRouter } from './routes/revisao';
import { entregaRouter } from './routes/entrega';
import { achadosRouter } from './routes/achados';
import { braveRouter } from './routes/brave';
import { atualizacaoRouter } from './routes/atualizacao';
import { navegadorRouter } from './routes/navegador';
import { healthRouter } from './routes/health';

async function main() {
  await initStore();
  await initCofre();
  await initTentativas();
  await initTrabalhos();
  await initAchados();
  limparPendentes();
  const orfas = await recuperarOrfas();

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  app.use('/api/config', configRouter);
  app.use('/api/cofre', cofreRouter);
  app.use('/api/sessoes', sessoesRouter);
  app.use('/api/tentativas', tentativasRouter);
  app.use('/api/debug', debugRouter);
  app.use('/api/revisao', revisaoRouter);
  app.use('/api/entrega', entregaRouter);
  app.use('/api/achados', achadosRouter);
  app.use('/api/brave', braveRouter);
  app.use('/api/atualizacao', atualizacaoRouter);
  app.use('/api/navegador', navegadorRouter);
  app.use('/api/health', healthRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'rota não encontrada' }));

  // Frontend buildado: em produção um processo só serve API e interface.
  const temBuild = existsSync(join(WEB_DIST, 'index.html'));
  if (temBuild) {
    app.use(express.static(WEB_DIST));
    app.get('*', (_req, res) => res.sendFile(join(WEB_DIST, 'index.html')));
  }

  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error('[server] erro não tratado:', err);
      if (!res.headersSent) res.status(500).json({ error: 'erro interno' });
    },
  );

  const cfg = getConfig();
  const cofre = cofreDisponivel();

  app.listen(PORT, () => {
    console.log('');
    console.log(`  🎓 Diploma ${VERSION} — copiloto de LMS e web ${INSTALADO ? '(instalado)' : '(código-fonte)'}`);
    console.log(`  API:        http://localhost:${PORT}/api/health`);
    console.log(
      temBuild
        ? `  Interface:  http://localhost:${PORT}`
        : '  Interface:  rode `npm run dev` (Vite em http://localhost:5980)',
    );
    console.log(`  Alvo:       ${cfg.alvo.urlBase || '(nenhum domínio apontado ainda)'}`);
    console.log(
      `  Modo:       ${modoTravadoPorEnv() ? 'observar (TRAVADO por DIPLOMA_MODO=observar)' : cfg.modo}`,
    );
    console.log(
      `  Cofre:      ${cofre.ok ? `DPAPI ok — ${totalCredenciais()} credencial(is)` : `indisponível (${cofre.motivo})`}`,
    );
    console.log(
      `  Auth LLM:   ${hasApiKeyEnv() ? 'ANTHROPIC_API_KEY' : 'assinatura do Claude Code (rode `claude` e logue uma vez)'}`,
    );
    console.log(`  Projeto:    ${PROJECT_ROOT}`);
    console.log(`  Dados:      ${HOME}`);
    if (orfas > 0) console.log(`  ⚠️  ${orfas} sessão(ões) órfã(s) marcadas como interrompidas.`);
    console.log('');

    // `--abrir` vem do atalho do Windows: o servidor é um console, e quem o dono
    // quer ver é a interface. `start` sem título para o cmd não confundir a URL.
    if (process.argv.includes('--abrir')) {
      spawn('cmd', ['/c', 'start', '', `http://localhost:${PORT}`], { detached: true, stdio: 'ignore' }).unref();
    }

    // Consulta o GitHub depois do boot, sem segurar a subida: se houver versão
    // nova, a barra lateral mostra. Respeita o intervalo de 6 h da config.
    setTimeout(() => void verificarAtualizacao(false), 3000);
  });
}

// O Chromium não pode ficar de pé depois que o servidor morre.
for (const sinal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sinal, () => {
    void nav.fechar().finally(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('[server] falha ao iniciar:', err);
  process.exit(1);
});
