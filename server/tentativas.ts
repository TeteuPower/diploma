import { PATHS } from './env';
import { JsonFile, agora, getConfig } from './store';
import { log, aviso } from './log';

/**
 * O registro de tentativas.
 *
 * Quiz costuma dar um número limitado de tentativas, e gastar uma é
 * irreversível de um jeito que nenhum "desfazer" resolve. O dono quer poder
 * conferir o resultado no fim e ainda ter tentativa sobrando — então o padrão
 * é **uma só**, e a trava é código.
 *
 * Por que não confiar no prompt: o agente não tem como saber, sozinho, que já
 * abriu aquele quiz numa sessão anterior que morreu no meio. O registro é
 * persistido justamente para sobreviver a reinício — é a memória que ele não
 * tem.
 */

interface RegistroQuiz {
  /** Chave estável do quiz (cmid no Moodle, ou o caminho da URL). */
  quiz: string;
  /** Ids de tentativa já vistos. O tamanho é a contagem que vale. */
  tentativas: string[];
  primeiraEm: string;
  ultimaEm: string;
  /** Uma URL de exemplo, só para a auditoria fazer sentido a olho. */
  url: string;
}

const arquivo = new JsonFile<RegistroQuiz[]>(PATHS.tentativas, []);

export async function initTentativas(): Promise<void> {
  await arquivo.load();
}

/**
 * Extrai a identidade do quiz e da tentativa a partir da URL.
 *
 * Genérico por necessidade: a aplicação não tem adaptador de LMS. A
 * heurística cobre o formato que praticamente todo LMS usa — o quiz é um id
 * na query (`cmid`, `id`, `quiz`) e a tentativa é outro (`attempt`,
 * `tentativa`). Quando nada casa, caímos no caminho da URL, que ao menos
 * distingue um quiz de outro.
 */
export function identificar(url: string): { quiz: string; tentativa: string | null } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }

  const q = u.searchParams;
  const idQuiz = q.get('cmid') ?? q.get('quiz') ?? q.get('id');
  const idTentativa = q.get('attempt') ?? q.get('tentativa');

  // Sem nenhum sinal de tentativa nem de quiz, não há o que registrar.
  if (!idQuiz && !idTentativa) return null;

  const quiz = idQuiz ? `${u.host}${u.pathname.replace(/\/[^/]*$/, '')}#${idQuiz}` : `${u.host}${u.pathname}`;
  return { quiz, tentativa: idTentativa };
}

/** Quantas tentativas já foram registradas para o quiz desta URL. */
export function contar(url: string): number {
  const id = identificar(url);
  if (!id) return 0;
  return arquivo.get().find((r) => r.quiz === id.quiz)?.tentativas.length ?? 0;
}

/**
 * Registra passivamente: chamado a cada navegação. É assim que uma tentativa
 * aberta pelo caminho (redirect do LMS, retomada de sessão) entra na conta sem
 * depender do agente declarar nada.
 */
export async function observar(url: string): Promise<void> {
  const id = identificar(url);
  if (!id?.tentativa) return;

  const atual = arquivo.get();
  const existente = atual.find((r) => r.quiz === id.quiz);

  if (existente) {
    if (existente.tentativas.includes(id.tentativa)) return; // já contada
    existente.tentativas.push(id.tentativa);
    existente.ultimaEm = agora();
    existente.url = url;
    aviso('tentativas', 'nova tentativa observada neste quiz', {
      quiz: id.quiz,
      tentativa: id.tentativa,
      total: existente.tentativas.length,
    });
  } else {
    atual.push({
      quiz: id.quiz,
      tentativas: [id.tentativa],
      primeiraEm: agora(),
      ultimaEm: agora(),
      url,
    });
    log('tentativas', 'primeira tentativa registrada', { quiz: id.quiz, tentativa: id.tentativa });
  }

  arquivo.setSync([...atual]);
  await arquivo.flush();
}

export interface Veredito {
  permitido: boolean;
  motivo: string;
  jaFeitas: number;
  limite: number;
}

/**
 * A pergunta que o portão faz antes de deixar iniciar uma tentativa.
 *
 * Nota sobre o que isto NÃO faz: se o agente já está dentro de uma tentativa
 * aberta, continuar respondendo é permitido — o limite é de ABRIR, não de
 * trabalhar. O que não pode é começar a segunda.
 */
export function podeIniciar(url: string): Veredito {
  const limite = getConfig().tentativasPorQuiz;
  const id = identificar(url);

  if (!id) {
    return {
      permitido: true,
      motivo: 'não deu para identificar o quiz nesta URL; a trava não se aplica',
      jaFeitas: 0,
      limite,
    };
  }

  const registro = arquivo.get().find((r) => r.quiz === id.quiz);
  const jaFeitas = registro?.tentativas.length ?? 0;

  // Já estamos DENTRO de uma tentativa conhecida: seguir não abre outra.
  if (id.tentativa && registro?.tentativas.includes(id.tentativa)) {
    return {
      permitido: true,
      motivo: 'esta tentativa já está aberta; continuar nela não consome outra',
      jaFeitas,
      limite,
    };
  }

  if (jaFeitas >= limite) {
    return {
      permitido: false,
      motivo:
        `este quiz já teve ${jaFeitas} tentativa(s) e o limite configurado é ${limite}. ` +
        'Iniciar outra queimaria uma tentativa que o dono quer preservar. ' +
        'Se a anterior ficou aberta, volte para ela em vez de começar uma nova.',
      jaFeitas,
      limite,
    };
  }

  return { permitido: true, motivo: `tentativa ${jaFeitas + 1} de ${limite}`, jaFeitas, limite };
}

/** Para a UI: o que já foi gasto, por quiz. */
export function listar(): RegistroQuiz[] {
  return arquivo.get();
}

/** O dono pode zerar — é ele quem sabe se a faculdade liberou mais tentativas. */
export async function esquecer(quiz: string): Promise<boolean> {
  const antes = arquivo.get();
  const depois = antes.filter((r) => r.quiz !== quiz);
  if (depois.length === antes.length) return false;
  arquivo.setSync(depois);
  await arquivo.flush();
  log('tentativas', 'registro apagado pelo dono', { quiz });
  return true;
}
