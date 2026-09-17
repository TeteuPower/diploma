import { Router } from 'express';
import { getConfig, patchConfig } from '../store';
import { normalizarHost } from '../hosts';
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

  if (typeof b.tentativasPorQuiz === 'number' && Number.isFinite(b.tentativasPorQuiz)) {
    out.tentativasPorQuiz = Math.min(10, Math.max(1, Math.round(b.tentativasPorQuiz)));
  }
  if (typeof b.permitirEntrega === 'boolean') out.permitirEntrega = b.permitirEntrega;

  if (b.web && typeof b.web === 'object') {
    const w = b.web as Record<string, unknown>;
    out.web = {
      politicaPadrao: w.politicaPadrao === 'lista' ? 'lista' : 'aberto',
      listaGlobal: Array.isArray(w.listaGlobal)
        ? w.listaGlobal
            .filter((h): h is string => typeof h === 'string')
            .map(normalizarHost)
            .filter(Boolean)
            .slice(0, 200)
        : [],
    };
  }

  if (b.perfil && typeof b.perfil === 'object') {
    const pf = b.perfil as Record<string, unknown>;
    const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    out.perfil = {
      nome: str(pf.nome, 120),
      cep: str(pf.cep, 12),
      endereco: str(pf.endereco, 200),
      cidade: str(pf.cidade, 80),
      uf: str(pf.uf, 2).toUpperCase(),
      telefone: str(pf.telefone, 30),
      email: str(pf.email, 120),
    };
  }

  if (b.atualizacao && typeof b.atualizacao === 'object') {
    const at = b.atualizacao as Record<string, unknown>;
    const repo = typeof at.repositorio === 'string' ? at.repositorio.trim() : '';
    out.atualizacao = {
      verificar: at.verificar !== false,
      // "dono/repo" e nada mais: não deixamos uma URL inteira virar parte da URL da API.
      repositorio: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? repo : '',
      preReleases: Boolean(at.preReleases),
    };
  }

  if (typeof b.permitirMaquina === 'boolean') out.permitirMaquina = b.permitirMaquina;

  if (b.brave && typeof b.brave === 'object') {
    const br = b.brave as Record<string, unknown>;
    out.brave = { pais: typeof br.pais === 'string' ? br.pais.trim().toUpperCase().slice(0, 2) : '' };
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
