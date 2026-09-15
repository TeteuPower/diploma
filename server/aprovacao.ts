import { getConfig, getSessao, patchSessao, appendPasso, agora, genId } from './store';
import { modoTravadoPorEnv } from './env';
import type { AcaoSensivel, ModoAutonomia, PedidoAprovacao } from '../shared/types';

/**
 * O portão que decide se uma ação acontece.
 *
 * O ponto central: quando o modo exige aprovação, a ferramenta MCP **bloqueia
 * de verdade** — ela fica pendurada numa Promise até o dono responder na UI.
 * Isso é o que faz a trava funcionar: a query() do SDK fica parada esperando o
 * resultado da ferramenta, então o agente não tem como "seguir mesmo assim".
 * Aprovação via prompt seria um pedido; isto é uma condição de execução.
 */

type Decisao = { aprovado: boolean; motivo: string };

/** Quem está esperando: id do pedido → resolve da Promise da ferramenta. */
const pendentes = new Map<string, (d: Decisao) => void>();

/** O modo que vale agora — a env ganha da config, sempre. */
export function modoEfetivo(): ModoAutonomia {
  return modoTravadoPorEnv() ? 'observar' : getConfig().modo;
}

export type Veredito =
  | { tipo: 'siga' }
  | { tipo: 'recusado'; motivo: string }
  | { tipo: 'precisa-aprovacao' };

/**
 * Decide o destino de uma ação, só pelo modo. Sem efeito colateral — quem
 * chama é que abre o pedido ou recusa.
 */
export function avaliar(acao: AcaoSensivel | 'interacao'): Veredito {
  const modo = modoEfetivo();

  if (modo === 'observar') {
    return {
      tipo: 'recusado',
      motivo:
        'modo "observar": nenhuma ação é executada. Descreva o que você faria e ' +
        'siga lendo a página — o dono executa na mão.',
    };
  }

  if (modo === 'autonomo') return { tipo: 'siga' };

  if (modo === 'assistido') {
    // Assistido trava tudo que muda estado. Interação de navegação (abrir uma
    // seção, rolar) passa: travar isso tornaria o modo inútil na prática.
    return acao === 'interacao' ? { tipo: 'siga' } : { tipo: 'precisa-aprovacao' };
  }

  // guiado: só o que o dono marcou.
  if (acao === 'interacao') return { tipo: 'siga' };
  return getConfig().exigemAprovacao.includes(acao)
    ? { tipo: 'precisa-aprovacao' }
    : { tipo: 'siga' };
}

/**
 * Abre um pedido e espera. Resolve quando o dono decide na UI, ou quando estoura
 * o tempo — e aí a resposta é "não", porque silêncio não é consentimento numa
 * ação irreversível.
 */
export async function pedir(
  sessaoId: string,
  acao: AcaoSensivel,
  descricao: string,
  detalhe: string,
): Promise<Decisao> {
  const sessao = getSessao(sessaoId);
  if (!sessao) return { aprovado: false, motivo: 'sessão não existe mais' };

  const pedido: PedidoAprovacao = {
    id: genId('apr'),
    at: agora(),
    acao,
    descricao,
    detalhe,
    url: sessao.urlAtual ?? '',
  };

  await patchSessao(sessaoId, { status: 'aguardando', pendente: pedido });
  await appendPasso(sessaoId, 'aprovacao', `Aguardando sua aprovação: ${descricao}`);

  const segundos = getConfig().navegador.timeoutAprovacaoS;

  return new Promise<Decisao>((resolve) => {
    let fechado = false;

    const terminar = (d: Decisao) => {
      if (fechado) return;
      fechado = true;
      clearTimeout(timer);
      pendentes.delete(pedido.id);
      resolve(d);
    };

    const timer = setTimeout(() => {
      void patchSessao(sessaoId, { status: 'rodando', pendente: null });
      void appendPasso(
        sessaoId,
        'recusado',
        `Pedido expirou depois de ${segundos}s sem resposta: ${descricao}`,
      );
      terminar({
        aprovado: false,
        motivo: `ninguém respondeu em ${segundos}s — a ação não foi executada`,
      });
    }, segundos * 1000);

    pendentes.set(pedido.id, terminar);
  });
}

/** Chamado pela rota quando o dono clica Aprovar/Recusar. */
export async function responder(
  sessaoId: string,
  pedidoId: string,
  aprovado: boolean,
  motivo = '',
): Promise<boolean> {
  const resolver = pendentes.get(pedidoId);
  if (!resolver) return false;

  await patchSessao(sessaoId, { status: 'rodando', pendente: null });
  await appendPasso(
    sessaoId,
    aprovado ? 'agiu' : 'recusado',
    aprovado ? 'Você aprovou a ação.' : `Você recusou a ação.${motivo ? ` Motivo: ${motivo}` : ''}`,
  );

  resolver({
    aprovado,
    motivo: motivo || (aprovado ? 'aprovado pelo dono' : 'recusado pelo dono'),
  });
  return true;
}

/** Reinício mata quem estava esperando: ninguém fica pendurado para sempre. */
export function limparPendentes(): void {
  for (const [, resolver] of pendentes) {
    resolver({ aprovado: false, motivo: 'servidor reiniciou durante a espera' });
  }
  pendentes.clear();
}
