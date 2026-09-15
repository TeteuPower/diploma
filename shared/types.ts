// -----------------------------------------------------------------------------
// Contrato de tipos único (servidor + web). Mexeu aqui → ajuste as duas pontas.
// -----------------------------------------------------------------------------

export type ModelChoice = 'default' | 'claude-opus-5' | 'claude-sonnet-5' | 'claude-haiku-4-5-20251001';
export type EffortChoice = 'low' | 'medium' | 'high';
export type NavOrientation = 'vertical' | 'horizontal';

/**
 * Quanta corda o agente tem. É parâmetro, não regra de código: os quatro modos
 * são aplicados no ponto de execução da ferramenta (server/ferramentas.ts),
 * nunca só no prompt — prompt não é trava de segurança.
 */
export type ModoAutonomia =
  | 'observar' // navega e lê; toda ação que mexe na página é recusada e só registrada
  | 'assistido' // age, mas pede aprovação antes de QUALQUER ação que muda estado
  | 'guiado' // age livre; aprovação só nas ações marcadas em `exigemAprovacao`
  | 'autonomo'; // executa ponta a ponta sem parar

/** Ações que deixam marca no LMS. No modo 'guiado' o dono escolhe quais travar. */
export type AcaoSensivel =
  | 'submeter' // enviar quiz/resposta — normalmente irreversível
  | 'iniciar_tentativa' // abrir uma tentativa costuma consumir uma das disponíveis
  | 'enviar_arquivo' // upload em atividade
  | 'marcar_concluido' // marcar conclusão manual
  | 'autenticar'; // fazer login com a credencial do cofre

export const ACOES_SENSIVEIS: AcaoSensivel[] = [
  'submeter',
  'iniciar_tentativa',
  'enviar_arquivo',
  'marcar_concluido',
  'autenticar',
];

export interface AlvoLms {
  /** Nome amigável, só para a UI. */
  nome: string;
  /** Domínio apontado. É a fronteira: o agente não navega para fora daqui. */
  urlBase: string;
  /** Caminho da tela de login, se não for a raiz. */
  caminhoLogin: string;
}

export interface ConfigNavegador {
  /** Headless é mais rápido; com janela você acompanha e resolve captcha na mão. */
  headless: boolean;
  /** Mantém cookies/sessão entre execuções (evita relogar toda hora). */
  perfilPersistente: boolean;
  /** Teto de espera por ação, em ms. */
  timeoutMs: number;
  /** Teto de passos por sessão — trava contra loop infinito. */
  maxPassos: number;
  /** Quanto tempo um pedido de aprovação espera o dono antes de desistir (s). */
  timeoutAprovacaoS: number;
}

export interface DiplomaConfig {
  alvo: AlvoLms;
  modo: ModoAutonomia;
  /** Usado só no modo 'guiado'. */
  exigemAprovacao: AcaoSensivel[];
  navegador: ConfigNavegador;
  modelo: ModelChoice;
  esforco: EffortChoice;
  /**
   * Quantas tentativas o agente pode ABRIR por quiz. Padrão 1: o dono quer ver
   * o resultado no fim e ainda ter tentativa sobrando. Continuar numa tentativa
   * já aberta não conta — o limite é de abrir, não de trabalhar.
   */
  tentativasPorQuiz: number;
  /**
   * Trava dura de entrega. Com false, o agente PODE produzir os arquivos mas
   * NÃO consegue enviar nada ao LMS: submeter, enviar arquivo e marcar
   * concluído são recusados no ponto de execução, não só no prompt. Começa
   * desligada de propósito — entregar é decisão do dono, e é irreversível.
   */
  permitirEntrega: boolean;
  /** Instruções livres que entram no system prompt (regras da disciplina etc). */
  instrucoes: string;
  navOrientation: NavOrientation;
}

// -----------------------------------------------------------------------------
// Cofre — metadados apenas. A senha NUNCA sai do servidor nem entra no contexto
// da LLM: ela é digitada direto no navegador pela ferramenta `autenticar`.
// -----------------------------------------------------------------------------

export interface CredencialMeta {
  id: string;
  /** Host a que ela pertence (ex.: 'ava.faculdade.edu.br'). */
  dominio: string;
  /** Usuário é identificador, não segredo — pode aparecer na UI. */
  usuario: string;
  rotulo: string;
  criadaEm: string;
  usadaEm: string | null;
}

export interface EstadoCofre {
  /** DPAPI destranca sozinho pela conta do Windows; em outro SO fica indisponível. */
  disponivel: boolean;
  motivo: string | null;
  credenciais: CredencialMeta[];
}

// -----------------------------------------------------------------------------
// Sessão — uma execução do agente contra o LMS.
// -----------------------------------------------------------------------------

export type StatusSessao =
  | 'ociosa'
  | 'rodando'
  | 'aguardando' // travada num pedido de aprovação
  | 'concluida'
  | 'erro'
  | 'interrompida'; // processo morreu no meio

export type TipoPasso =
  | 'navegou'
  | 'leu'
  | 'agiu'
  | 'pensou'
  | 'recusado' // ação bloqueada pelo modo/fronteira de domínio
  | 'aprovacao'
  | 'erro'
  | 'status';

export interface Passo {
  id: string;
  at: string;
  tipo: TipoPasso;
  /** Nome da ferramenta, quando o passo veio de uma. */
  ferramenta?: string;
  resumo: string;
  url?: string;
}

export interface PedidoAprovacao {
  id: string;
  at: string;
  acao: AcaoSensivel;
  /** O que o agente quer fazer, em uma linha. */
  descricao: string;
  /** O conteúdo exato em jogo (as respostas que serão enviadas, o arquivo etc). */
  detalhe: string;
  url: string;
}

export interface Sessao {
  id: string;
  objetivo: string;
  status: StatusSessao;
  modo: ModoAutonomia;
  urlAtual: string | null;
  passos: Passo[];
  /** Não-nulo ⇒ status 'aguardando' e a ferramenta está bloqueada esperando. */
  pendente: PedidoAprovacao | null;
  /** session_id do Agent SDK, para retomar de onde parou. */
  sessionId: string | null;
  resultado: string | null;
  criadaEm: string;
  atualizadaEm: string;
}

// -----------------------------------------------------------------------------
// Streams
// -----------------------------------------------------------------------------

export type SessaoStreamEvent =
  | { type: 'snapshot'; sessoes: Sessao[] }
  | { type: 'sessao'; sessao: Sessao }
  | { type: 'removida'; id: string }
  | { type: 'ping' };

export interface HealthInfo {
  ok: boolean;
  version: string;
  /** Origem real da credencial da LLM, reportada pelo SDK. */
  auth: 'subscription' | 'apiKey';
  cofre: { disponivel: boolean; motivo: string | null; total: number };
  navegador: { instalado: boolean; aberto: boolean };
  cwd: string;
}

// -----------------------------------------------------------------------------
// Painel de entrega — o que a aplicação confere no disco, não o que o agente diz.
// -----------------------------------------------------------------------------

export interface Suspeita {
  caminho: string;
  linha: number;
  trecho: string;
}

export interface ArquivoEntrega {
  caminho: string;
  bytes: number;
  /** Assinatura conferida byte a byte. Extensão .pdf não prova nada. */
  pdfValido?: boolean;
}

export interface PacoteZip {
  caminho: string;
  bytes: number;
  itens: string[];
  /** Recado interno que vazou para dentro do pacote. Tem que estar vazio. */
  itensInternos: string[];
}

export interface Atividade {
  pasta: string;
  arquivos: ArquivoEntrega[];
  bytes: number;
  zip: PacoteZip | null;
  pdfs: ArquivoEntrega[];
  suspeitas: Suspeita[];
}

export interface PainelEntrega {
  atividades: Atividade[];
  notas: { atividade: string; conteudo: string }[];
  totais: { atividades: number; arquivos: number; bytes: number; zips: number; suspeitas: number };
  geradoEm: string;
}
