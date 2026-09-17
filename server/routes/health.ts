import { Router } from 'express';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { VERSION, PROJECT_ROOT, INSTALADO } from '../env';
import { estado as estadoAtualizacao } from '../atualizacao';
import { resolverAuth } from '../authState';
import * as cofre from '../cofre';
import * as nav from '../navegador';
import * as maquina from '../maquina';
import { getConfig } from '../store';
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

/**
 * A camada de máquina responde? Conferida uma vez e guardada: cada checagem
 * sobe um PowerShell, e a saúde é consultada a cada 15 s pela interface.
 */
let maquinaOk: { ok: boolean; motivo: string | null } | null = null;
void maquina.disponivel().then((r) => (maquinaOk = r));

healthRouter.get('/', (_req, res) => {
  const d = cofre.disponivel();
  const info: HealthInfo = {
    ok: true,
    version: VERSION,
    auth: resolverAuth(),
    cofre: { disponivel: d.ok, motivo: d.motivo, total: cofre.total() },
    navegador: { instalado: navegadorInstalado(), aberto: nav.estaAberto() },
    cwd: PROJECT_ROOT,
    maquina: {
      disponivel: maquinaOk?.ok ?? false,
      motivo: maquinaOk?.motivo ?? 'ainda verificando',
      permitida: getConfig().permitirMaquina,
    },
    instalado: INSTALADO,
    atualizacaoDisponivel: estadoAtualizacao().disponivel?.versao ?? null,
  };
  res.json(info);
});
