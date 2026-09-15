import type { ModoAutonomia, AcaoSensivel, TipoPasso, StatusSessao } from '@shared/types';

export const ROTULO_MODO: Record<ModoAutonomia, string> = {
  observar: 'Observar',
  assistido: 'Assistido',
  guiado: 'Guiado',
  autonomo: 'Autônomo',
};

/** A cor sobe com a corda: verde-água → âmbar → vermelho. */
export const CORES_MODO: Record<ModoAutonomia, string> = {
  observar: '#8b7bff',
  assistido: '#38e0d8',
  guiado: '#f5b955',
  autonomo: '#f47174',
};

export const DESCRICAO_MODO: Record<ModoAutonomia, string> = {
  observar:
    'Navega e lê, mas nenhuma ação é executada. Ele descreve o que faria — onde clicaria, qual alternativa marcaria — e você executa na mão.',
  assistido:
    'Age livremente para navegar e preencher, mas para e espera sua aprovação antes de qualquer coisa que mude o estado no LMS.',
  guiado:
    'Opera sozinho. Só as ações que você marcar abaixo param para aprovação.',
  autonomo:
    'Executa ponta a ponta sem parar. Nada fica entre a leitura dele e o envio — inclusive quando ele entende a questão errado.',
};

export const ICONE_MODO: Record<ModoAutonomia, string> = {
  observar: '👁️',
  assistido: '🤝',
  guiado: '🎚️',
  autonomo: '🚀',
};

export const ROTULO_ACAO: Record<AcaoSensivel, string> = {
  submeter: 'Enviar respostas / finalizar',
  iniciar_tentativa: 'Iniciar uma tentativa',
  enviar_arquivo: 'Enviar arquivo',
  marcar_concluido: 'Marcar como concluído',
  autenticar: 'Fazer login com o cofre',
};

export const HINT_ACAO: Record<AcaoSensivel, string> = {
  submeter: 'Quase sempre irreversível — é a nota indo embora.',
  iniciar_tentativa: 'Abrir uma tentativa costuma consumir uma das disponíveis.',
  enviar_arquivo: 'Upload em atividade.',
  marcar_concluido: 'Conclusão manual de item do curso.',
  autenticar: 'Usar a credencial guardada para entrar.',
};

export const ICONE_PASSO: Record<TipoPasso, string> = {
  navegou: '🧭',
  leu: '👀',
  agiu: '✅',
  pensou: '💭',
  recusado: '🛑',
  aprovacao: '⏸️',
  erro: '⚠️',
  status: 'ℹ️',
};

export const COR_PASSO: Record<TipoPasso, string> = {
  navegou: '#8b7bff',
  leu: 'rgba(255,255,255,0.35)',
  agiu: '#38e0d8',
  pensou: 'rgba(255,255,255,0.45)',
  recusado: '#f5b955',
  aprovacao: '#f5b955',
  erro: '#f47174',
  status: 'rgba(255,255,255,0.35)',
};

export const COR_STATUS: Record<StatusSessao, string> = {
  ociosa: 'rgba(255,255,255,0.4)',
  rodando: '#38e0d8',
  aguardando: '#f5b955',
  concluida: '#6ee7df',
  erro: '#f47174',
  interrompida: 'rgba(255,255,255,0.4)',
};

export const ROTULO_STATUS: Record<StatusSessao, string> = {
  ociosa: 'ociosa',
  rodando: 'rodando',
  aguardando: 'esperando você',
  concluida: 'concluída',
  erro: 'erro',
  interrompida: 'interrompida',
};

/** Hora curta — a trilha é lida de relance, data completa só atrapalha. */
export function hora(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '';
  }
}

export function dataHora(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
