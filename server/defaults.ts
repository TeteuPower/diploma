import type { DiplomaConfig } from '../shared/types';

export const DEFAULT_CONFIG: DiplomaConfig = {
  alvo: {
    nome: '',
    urlBase: '',
    caminhoLogin: '/login',
  },
  // Começa no modo mais conservador de propósito: o dono sobe a autonomia
  // depois de ver o agente acertar, não antes.
  modo: 'assistido',
  exigemAprovacao: ['submeter', 'iniciar_tentativa', 'enviar_arquivo'],
  navegador: {
    headless: false,
    perfilPersistente: true,
    timeoutMs: 20000,
    maxPassos: 80,
    timeoutAprovacaoS: 600,
  },
  tentativasPorQuiz: 1,
  permitirEntrega: false,
  modelo: 'default',
  esforco: 'medium',
  instrucoes: '',
  navOrientation: 'vertical',
};
