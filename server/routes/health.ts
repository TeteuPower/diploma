import { Router } from 'express';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { VERSION, PROJECT_ROOT } from '../env';
import { resolverAuth } from '../authState';
import * as cofre from '../cofre';
import * as nav from '../navegador';
import type { HealthInfo } from '../../shared/types';

export const healthRouter = Router();

/**
 * Chromium baixado? Sem isso o agente falha no primeiro `abrir`, e a UI precisa
 * conseguir dizer "rode npm run navegador" em vez de deixar o dono descobrir
 * no meio de uma sessão. `executablePath()` aponta o binário sem abrir nada.
 */
function navegadorInstalado(): boolean {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

healthRouter.get('/', (_req, res) => {
  const d = cofre.disponivel();
  const info: HealthInfo = {
    ok: true,
    version: VERSION,
    auth: resolverAuth(),
    cofre: { disponivel: d.ok, motivo: d.motivo, total: cofre.total() },
    navegador: { instalado: navegadorInstalado(), aberto: nav.estaAberto() },
    cwd: PROJECT_ROOT,
  };
  res.json(info);
});
