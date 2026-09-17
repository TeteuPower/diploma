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
  web: {
    // Aberto por padrão porque "encontre tudo sobre" não cabe numa allowlist.
    // O que protege o dono não é a lista, é a credencial presa ao host dela.
    politicaPadrao: 'aberto',
    listaGlobal: ['mercadolivre.com.br', 'olx.com.br', 'google.com', 'bing.com'],
  },
  perfil: { nome: '', cep: '', endereco: '', cidade: '', uf: '', telefone: '', email: '' },
  brave: { pais: 'BR' },
  atualizacao: { verificar: true, repositorio: 'TeteuPower/diploma', preReleases: false },
  permitirMaquina: false,
  modelo: 'default',
  esforco: 'medium',
  instrucoes: '',
  navOrientation: 'vertical',
};
