import { Router } from 'express';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PROJECT_ROOT } from '../env';
import { log, erro as logErro } from '../log';

export const navegadorRouter = Router();

/**
 * Instalar o Chromium por dentro do app.
 *
 * O instalador não embute o Chromium (~150 MB que mudam a cada versão do
 * Playwright, e o Playwright já os guarda em %LOCALAPPDATA%\ms-playwright, onde
 * sobrevivem a update). Então quem baixa é o próprio Playwright, chamado com o
 * MESMO executável que está rodando este servidor — instalado, é o Diploma.exe
 * (um node.exe renomeado); em dev, o node do PATH. Sem depender de `npx` nem
 * de npm existirem na máquina.
 */

interface Instalacao {
  rodando: boolean;
  ok: boolean | null;
  saida: string[];
  iniciadaEm: string | null;
}

const estado: Instalacao = { rodando: false, ok: null, saida: [], iniciadaEm: null };

navegadorRouter.get('/instalacao', (_req, res) => {
  let instalado = false;
  try {
    instalado = existsSync(chromium.executablePath());
  } catch {
    /* sem executablePath: não instalado */
  }
  res.json({ instalado, ...estado, saida: estado.saida.slice(-30) });
});

navegadorRouter.post('/instalar', (_req, res) => {
  if (estado.rodando) return res.status(409).json({ error: 'instalação já em andamento' });

  const cli = join(PROJECT_ROOT, 'node_modules', 'playwright', 'cli.js');
  if (!existsSync(cli)) {
    return res.status(500).json({ error: `não achei o cli do Playwright em ${cli}` });
  }

  estado.rodando = true;
  estado.ok = null;
  estado.saida = [];
  estado.iniciadaEm = new Date().toISOString();
  log('navegador', 'instalando o Chromium via Playwright', { exec: process.execPath });

  const filho = spawn(process.execPath, [cli, 'install', 'chromium'], {
    cwd: PROJECT_ROOT,
    windowsHide: true,
  });
  const anotar = (d: Buffer) => {
    for (const l of d.toString('utf8').split(/\r?\n/)) {
      if (l.trim()) estado.saida.push(l.trim().slice(0, 200));
    }
    if (estado.saida.length > 200) estado.saida.splice(0, estado.saida.length - 200);
  };
  filho.stdout.on('data', anotar);
  filho.stderr.on('data', anotar);
  filho.on('error', (e) => {
    estado.rodando = false;
    estado.ok = false;
    estado.saida.push(`erro: ${e.message}`);
    logErro('navegador', 'instalação do Chromium não iniciou', e);
  });
  filho.on('close', (code) => {
    estado.rodando = false;
    estado.ok = code === 0;
    log('navegador', 'instalação do Chromium terminou', { codigo: code });
  });

  res.status(202).json({ ok: true, iniciado: true });
});
