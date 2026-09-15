import { Router } from 'express';
import { getConfig, patchConfig } from '../store';
import { ACOES_SENSIVEIS } from '../../shared/types';
import type { DiplomaConfig, AcaoSensivel, ModoAutonomia } from '../../shared/types';

export const configRouter = Router();

const MODOS: ModoAutonomia[] = ['observar', 'assistido', 'guiado', 'autonomo'];

/** Sanitiza o PATCH: nada entra na config sem passar por aqui. */
function limpar(bruto: unknown): Partial<DiplomaConfig> {
  const b = (bruto ?? {}) as Record<string, unknown>;
  const out: Partial<DiplomaConfig> = {};

  if (b.alvo && typeof b.alvo === 'object') {
    const a = b.alvo as Record<string, unknown>;
    out.alvo = {
      nome: typeof a.nome === 'string' ? a.nome.slice(0, 120) : '',
      urlBase: typeof a.urlBase === 'string' ? a.urlBase.trim().slice(0, 300) : '',
      caminhoLogin: typeof a.caminhoLogin === 'string' ? a.caminhoLogin.trim().slice(0, 200) : '/login',
    };
  }

  if (typeof b.modo === 'string' && MODOS.includes(b.modo as ModoAutonomia)) {
    out.modo = b.modo as ModoAutonomia;
  }

  if (Array.isArray(b.exigemAprovacao)) {
    out.exigemAprovacao = b.exigemAprovacao.filter(
      (x): x is AcaoSensivel => typeof x === 'string' && ACOES_SENSIVEIS.includes(x as AcaoSensivel),
    );
  }

  if (b.navegador && typeof b.navegador === 'object') {
    const n = b.navegador as Record<string, unknown>;
    const num = (v: unknown, min: number, max: number, pad: number) =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : pad;
    out.navegador = {
      headless: Boolean(n.headless),
      perfilPersistente: n.perfilPersistente !== false,
      timeoutMs: num(n.timeoutMs, 3000, 120000, 20000),
      maxPassos: num(n.maxPassos, 5, 500, 80),
      timeoutAprovacaoS: num(n.timeoutAprovacaoS, 30, 7200, 600),
    };
  }

  if (typeof b.modelo === 'string') out.modelo = b.modelo as DiplomaConfig['modelo'];
  if (b.esforco === 'low' || b.esforco === 'medium' || b.esforco === 'high') out.esforco = b.esforco;
  if (typeof b.instrucoes === 'string') out.instrucoes = b.instrucoes.slice(0, 8000);
  if (b.navOrientation === 'vertical' || b.navOrientation === 'horizontal') {
    out.navOrientation = b.navOrientation;
  }

  return out;
}

configRouter.get('/', (_req, res) => res.json(getConfig()));

configRouter.patch('/', async (req, res) => {
  res.json(await patchConfig(limpar(req.body)));
});
