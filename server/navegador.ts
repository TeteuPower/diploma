import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page, Frame, Locator } from 'playwright';
import type { PoliticaDominio } from '../shared/types';
import { PERFIL_DIR } from './env';
import { getConfig } from './store';
import { fonteInstantaneo, ATRIBUTO_REF, type ResultadoInstantaneo } from './instantaneo';
import { revelarParaNavegador } from './cofre';
import { log, erro as logErro, cronometro } from './log';
import { observar } from './tentativas';
import { normalizarHost } from './hosts';

/**
 * A camada de navegador. Playwright + Chromium.
 *
 * Três decisões que o código sozinho não explica:
 *
 * 1. **Contexto persistente por padrão.** O perfil vive em `perfil-navegador/`,
 *    então o cookie de sessão do LMS sobrevive entre execuções. Na prática isso
 *    significa que o agente loga uma vez e nas próximas sessões já entra —
 *    menos login é menos chance de tropeçar em captcha e 2FA.
 *
 * 2. **Fronteira de domínio é código, não prompt.** `navegar` recusa qualquer
 *    host fora do alvo configurado. Um prompt pedindo "não saia do domínio" é
 *    sugestão; isto aqui é parede. Vale contra alucinação e contra link
 *    malicioso plantado numa página do curso.
 *
 * 3. **Ref resolve por atributo, não por seletor CSS.** O instantâneo carimba
 *    `data-diploma-ref` em cada elemento acionável e as ações endereçam por ele.
 *    Seletor gerado por LLM quebra a cada re-render; o carimbo não.
 */

let browser: Browser | null = null;
let contexto: BrowserContext | null = null;
let pagina: Page | null = null;

export function estaAberto(): boolean {
  return contexto !== null;
}

export function urlAtual(): string | null {
  try {
    return pagina ? pagina.url() : null;
  } catch {
    return null;
  }
}

/** Host do alvo configurado. Vazio ⇒ nenhum domínio apontado ainda. */
function hostAlvo(): string {
  const base = getConfig().alvo.urlBase.trim();
  if (!base) return '';
  try {
    return new URL(base.includes('://') ? base : `https://${base}`).host.toLowerCase();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Política de domínio
// ---------------------------------------------------------------------------

/**
 * A política em vigor. É definida quando a sessão começa e volta ao restrito
 * quando ela termina — o navegador é um só, então a sessão que roda é a que
 * manda. Começa restrita para que nada navegue antes de alguém dizer para onde.
 */
let politicaAtiva: PoliticaDominio = { modo: 'restrito', hosts: [] };

export function definirPolitica(p: PoliticaDominio): void {
  // Normaliza aqui também, não só na criação da sessão: quem chama pode passar
  // a lista como o dono colou (URL inteira, www, barra), e a comparação é por host.
  politicaAtiva = { modo: p.modo, hosts: p.hosts.map(normalizarHost).filter(Boolean) };
  log('navegador', 'política de domínio definida', { modo: p.modo, hosts: p.hosts.length });
}

export function politicaAtual(): PoliticaDominio {
  return politicaAtiva;
}

const casaHost = (host: string, permitido: string): boolean =>
  host === permitido || host.endsWith(`.${permitido}`);

/**
 * A parede, agora com três formatos. O que NÃO muda em nenhum deles:
 *
 * - **https só.** Http em claro só para localhost (é como os testes sobem o LMS
 *   falso). Uma pesquisa de preço não pode passar por site sem TLS: tudo que o
 *   agente digitar lá — inclusive o CEP do dono — viajaria legível.
 * - **credencial presa ao host.** Isso não vive aqui, vive em `cofre.paraUrl`,
 *   que só devolve a credencial cujo domínio casa com a URL atual. Abrir a
 *   política não abre o cofre.
 */
export function permitido(url: string): { ok: true } | { ok: false; motivo: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, motivo: `URL inválida: ${url}` };
  }
  const host = u.host.toLowerCase();
  const local = host === 'localhost' || host.startsWith('localhost:') || host.startsWith('127.0.0.1');

  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) {
    return { ok: false, motivo: `só https (recebi ${u.protocol}//${host})` };
  }

  const p = politicaAtiva;
  if (p.modo === 'aberto') return { ok: true };

  if (p.modo === 'restrito') {
    const alvo = hostAlvo();
    if (!alvo) return { ok: false, motivo: 'nenhum domínio LMS apontado na configuração' };
    return casaHost(host, alvo)
      ? { ok: true }
      : { ok: false, motivo: `fora do alvo LMS (${alvo}): ${host}` };
  }

  // lista: a da missão, ou a global da config quando a missão não trouxe a sua.
  const hosts = p.hosts.length ? p.hosts : getConfig().web.listaGlobal;
  if (!hosts.length) return { ok: false, motivo: 'política "lista" sem nenhum host permitido' };
  return hosts.some((h) => casaHost(host, h))
    ? { ok: true }
    : { ok: false, motivo: `fora da lista permitida: ${host}` };
}

/** Compatibilidade: a pergunta antiga, respondida pela política atual. */
export function dentroDoAlvo(url: string): boolean {
  return permitido(url).ok;
}

export async function abrir(): Promise<Page> {
  if (pagina && contexto) return pagina;

  const cfg = getConfig();
  const { headless, perfilPersistente, timeoutMs } = cfg.navegador;

  const opcoes = {
    headless,
    viewport: { width: 1440, height: 900 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    args: ['--disable-blink-features=AutomationControlled'],
  };

  if (perfilPersistente) {
    contexto = await chromium.launchPersistentContext(PERFIL_DIR, opcoes);
    browser = null;
    pagina = contexto.pages()[0] ?? (await contexto.newPage());
  } else {
    browser = await chromium.launch({ headless, args: opcoes.args });
    contexto = await browser.newContext({
      viewport: opcoes.viewport,
      locale: opcoes.locale,
      timezoneId: opcoes.timezoneId,
    });
    pagina = await contexto.newPage();
  }

  contexto.setDefaultTimeout(timeoutMs);
  contexto.setDefaultNavigationTimeout(timeoutMs * 2);

  // Registro passivo de tentativas. Escutamos a navegação do frame principal em
  // vez de registrar dentro de `navegar()` porque tentativa quase nunca nasce
  // de uma URL digitada: nasce de um POST em "Iniciar tentativa" e do redirect
  // que vem depois. Aqui nada escapa.
  pagina.on('framenavigated', (f) => {
    if (f === pagina?.mainFrame()) void observar(f.url());
  });

  // Fechar a janela na mão não pode deixar o servidor achando que ainda há página.
  contexto.on('close', () => {
    contexto = null;
    pagina = null;
    browser = null;
  });

  log('navegador', 'aberto', { headless, perfilPersistente });
  return pagina;
}

export async function fechar(): Promise<void> {
  try {
    await contexto?.close();
    await browser?.close();
  } catch {
    /* já estava fechado */
  }
  contexto = null;
  pagina = null;
  browser = null;
}

function exigirPagina(): Page {
  if (!pagina) throw new Error('navegador não está aberto');
  return pagina;
}

// ---------------------------------------------------------------------------
// Instantâneo
// ---------------------------------------------------------------------------

/**
 * Frames entram no instantâneo porque LMS é feito deles: SCORM, H5P, vídeo e
 * questão embutida vivem em iframe. Sem isso o agente veria a moldura vazia.
 * O ref ganha o prefixo do frame (`f2e7`) e a ação resolve o frame de volta.
 */
export async function instantaneo(maxLinhas = 400): Promise<string> {
  const page = exigirPagina();
  const medir = cronometro();
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 8000 });
  } catch {
    /* página lenta: seguimos com o que já renderizou */
  }

  const frames = page.frames();
  const blocos: string[] = [];
  let total = 0;
  let truncou = false;

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    let r: ResultadoInstantaneo;
    try {
      r = (await frame.evaluate(fonteInstantaneo(ATRIBUTO_REF, maxLinhas))) as ResultadoInstantaneo;
    } catch (err) {
      // Frame filho cross-origin ou destruído no meio é rotina — segue. Mas se
      // o frame principal falhou, o instantâneo inteiro é inútil e esconder
      // isso faria o agente trabalhar às cegas.
      if (i === 0) throw err;
      continue;
    }
    if (!r.linhas.trim()) continue;

    // Prefixo do frame: main = sem prefixo, filhos = f1, f2...
    const prefixo = i === 0 ? '' : `f${i}`;
    const linhas = prefixo ? r.linhas.replace(/ref=e(\d+)/g, `ref=${prefixo}e$1`) : r.linhas;

    if (i > 0) {
      blocos.push(`\n--- quadro embutido ${prefixo} (${frame.url().slice(0, 120)}) ---`);
    }
    blocos.push(linhas);
    total += r.totalElementos;
    truncou = truncou || r.truncado;
  }

  const cabecalho = `URL: ${page.url()}\nTítulo: ${await page.title().catch(() => '?')}`;
  const corpo = blocos.join('\n').trim() || '(página sem conteúdo legível)';
  const rodape = truncou
    ? `\n\n[instantâneo cortado em ${maxLinhas} linhas — role a página ou entre numa seção]`
    : `\n\n[${total} elementos acionáveis]`;

  const texto = `${cabecalho}\n\n${corpo}${rodape}`;
  // Estes números são o termômetro do instantâneo: zero elemento numa página
  // cheia significa que o filtro está comendo o que devia passar, e `truncado`
  // explica por que o agente não achou o botão que estava lá embaixo.
  log('instantaneo', 'coletado', {
    url: page.url(),
    elementos: total,
    linhas: texto.split('\n').length,
    chars: texto.length,
    truncado: truncou,
    frames: frames.length,
    ms: medir(),
  });
  return texto;
}

/** Descobre a que frame um ref pertence e devolve o seletor dentro dele. */
function resolverRef(ref: string): { frame: Frame; seletor: string } {
  const page = exigirPagina();
  const m = /^(?:f(\d+))?(e\d+)$/.exec(ref.trim());
  if (!m) throw new Error(`ref inválido: ${ref} (esperado e12 ou f1e12)`);
  const [, idxFrame, local] = m;
  const frames = page.frames();
  const frame = idxFrame ? frames[Number(idxFrame)] : frames[0];
  if (!frame) throw new Error(`quadro f${idxFrame} não existe mais — tire um instantâneo novo`);
  return { frame, seletor: `[${ATRIBUTO_REF}="${local}"]` };
}

// ---------------------------------------------------------------------------
// Ações
// ---------------------------------------------------------------------------

/**
 * Caminho relativo só faz sentido com um alvo LMS para ancorar. Numa missão web
 * sem alvo, "olx.com.br/tablet" vira "https://olx.com.br/tablet" — nunca http,
 * que a política recusaria em seguida de qualquer forma.
 */
function absolutizar(url: string): string {
  const limpa = url.trim();
  if (limpa.includes('://')) return limpa;
  const base = getConfig().alvo.urlBase.trim();
  if (base && limpa.startsWith('/')) {
    return new URL(limpa, base.includes('://') ? base : `https://${base}`).toString();
  }
  return `https://${limpa.replace(/^\/+/, '')}`;
}

export async function navegar(url: string): Promise<void> {
  const page = await abrir();
  const absoluta = absolutizar(url);

  const veredito = permitido(absoluta);
  if (!veredito.ok) {
    throw new Error(`${veredito.motivo}. Navegação recusada.`);
  }
  const medir = cronometro();
  await page.goto(absoluta, { waitUntil: 'domcontentloaded' });
  log('navegador', 'navegou', { url: absoluta, ms: medir() });
}

/**
 * Clique em três tentativas, da mais honesta para a mais bruta.
 *
 * O clique normal do Playwright espera o elemento ficar visível, estável e
 * dentro do viewport — proteções que existem por bons motivos e que, quando
 * não dão, dão errado devagar: 20 segundos até estourar, um turno inteiro
 * gasto. Aqui o prazo é curto e há plano B.
 *
 * `force` pula a checagem de acionabilidade mas ainda manda um clique de
 * verdade do mouse. O `el.click()` do DOM é o último recurso: não simula
 * mouse, então um widget que escuta mousedown não reage — mas resolve link,
 * botão e qualquer coisa com listener de `click`.
 *
 * Devolve por qual caminho passou, porque isso é informação de diagnóstico:
 * se tudo estiver caindo em 'dom', o instantâneo está apontando alvos ruins.
 */
export type ViaDoClique = 'normal' | 'forcado' | 'dom';

export async function clicar(ref: string): Promise<ViaDoClique> {
  const { frame, seletor } = resolverRef(ref);
  return clicarLocator(frame.locator(seletor).first(), ref);
}

async function clicarLocator(alvo: Locator, ref: string): Promise<ViaDoClique> {
  const prazo = Math.min(getConfig().navegador.timeoutMs, 8000);
  const medir = cronometro();

  try {
    await alvo.click({ timeout: prazo });
    await assentar();
    log('navegador', 'clique ok', { ref, via: 'normal', ms: medir() });
    return 'normal';
  } catch (err1) {
    log('navegador', 'clique normal não deu; tentando forçado', {
      ref,
      motivo: (err1 as Error).message?.split('\n')[0],
    });
    try {
      await alvo.click({ timeout: prazo, force: true });
      await assentar();
      log('navegador', 'clique ok', { ref, via: 'forcado', ms: medir() });
      return 'forcado';
    } catch (err2) {
      log('navegador', 'clique forçado não deu; tentando via DOM', {
        ref,
        motivo: (err2 as Error).message?.split('\n')[0],
      });
      await alvo.evaluate((el) => (el as HTMLElement).click());
      await assentar();
      log('navegador', 'clique ok', { ref, via: 'dom', ms: medir() });
      return 'dom';
    }
  }
}

export async function preencher(ref: string, texto: string): Promise<void> {
  const { frame, seletor } = resolverRef(ref);
  await frame.locator(seletor).first().fill(texto);
}

export async function selecionar(ref: string, valor: string): Promise<void> {
  const { frame, seletor } = resolverRef(ref);
  const alvo = frame.locator(seletor).first();
  // Tenta por valor; se não casar, cai para o rótulo visível — que é o que a
  // LLM tende a mandar quando o value é um id opaco.
  try {
    await alvo.selectOption({ value: valor });
  } catch {
    await alvo.selectOption({ label: valor });
  }
}

export async function marcar(ref: string, marcado: boolean): Promise<void> {
  const { frame, seletor } = resolverRef(ref);
  const alvo = frame.locator(seletor).first();

  // O ref pode estar no próprio input OU na fachada que o esconde (o card da
  // alternativa). `check()` só entende input — na fachada ele lança "Not a
  // checkbox or radio input", que foi exatamente como o quiz da FIAP travou.
  const ehInput = await alvo.evaluate((el) => {
    const t = (el as HTMLInputElement).type;
    return el.tagName === 'INPUT' && (t === 'checkbox' || t === 'radio');
  });

  if (ehInput) {
    if (marcado) await alvo.check();
    else await alvo.uncheck();
  } else {
    // Na fachada, clicar é o certo: é o que um humano faz, e é o que dispara os
    // listeners que o site pendurou no card. Radio não desmarca por clique, e
    // checkbox só alterna — então conferimos o estado e só clicamos se precisar.
    const jaEsta = await alvo.evaluate((el) => {
      const inp = el.querySelector('input') as HTMLInputElement | null;
      const porFor = (el as HTMLLabelElement).htmlFor
        ? (document.getElementById((el as HTMLLabelElement).htmlFor) as HTMLInputElement | null)
        : null;
      return (inp ?? porFor)?.checked ?? false;
    });
    if (jaEsta !== marcado) await clicarLocator(alvo, ref);
  }
  await assentar();
}

export async function rolar(direcao: 'baixo' | 'cima' | 'topo' | 'fim'): Promise<void> {
  const page = exigirPagina();
  const js = {
    baixo: () => window.scrollBy(0, window.innerHeight * 0.85),
    cima: () => window.scrollBy(0, -window.innerHeight * 0.85),
    topo: () => window.scrollTo(0, 0),
    fim: () => window.scrollTo(0, document.body.scrollHeight),
  }[direcao];
  await page.evaluate(js);
  await page.waitForTimeout(350);
}

export async function voltar(): Promise<void> {
  const page = exigirPagina();
  await page.goBack({ waitUntil: 'domcontentloaded' });
}

export async function esperarTexto(texto: string, segundos: number): Promise<boolean> {
  const page = exigirPagina();
  try {
    await page.getByText(texto, { exact: false }).first().waitFor({ timeout: segundos * 1000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Baixa um arquivo do LMS (enunciado em PDF, dataset, template).
 *
 * Usa o `request` do contexto do Playwright em vez de um fetch solto porque
 * ele compartilha os cookies da sessão logada — anexo de LMS quase sempre está
 * atrás de autenticação, e um fetch anônimo traria a página de login em vez do
 * arquivo. A fronteira de domínio vale aqui igual: não se baixa de fora do alvo.
 */
export async function baixar(url: string): Promise<{ dados: Buffer; tipo: string; nome: string }> {
  const page = await abrir();
  const absoluta = absolutizar(url);

  const veredito = permitido(absoluta);
  if (!veredito.ok) {
    throw new Error(`${veredito.motivo}. Download recusado.`);
  }

  const medir = cronometro();
  const resposta = await page.context().request.get(absoluta);
  if (!resposta.ok()) {
    throw new Error(`o servidor respondeu ${resposta.status()} ao baixar ${absoluta}`);
  }
  const dados = Buffer.from(await resposta.body());
  const tipo = resposta.headers()['content-type'] ?? 'application/octet-stream';

  // Nome: primeiro o que o servidor manda, senão o fim da URL.
  const disp = resposta.headers()['content-disposition'] ?? '';
  const doHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp)?.[1];
  const daUrl = decodeURIComponent(new URL(absoluta).pathname.split('/').pop() || 'anexo');
  const nome = (doHeader ?? daUrl).trim() || 'anexo';

  log('navegador', 'baixou', { url: absoluta, bytes: dados.byteLength, tipo, nome, ms: medir() });
  return { dados, tipo, nome };
}

/** O href de um ref, para saber o que um link baixaria antes de baixar. */
export async function hrefDe(ref: string): Promise<string | null> {
  const { frame, seletor } = resolverRef(ref);
  return frame.locator(seletor).first().getAttribute('href');
}

/** Screenshot em JPEG base64 — o recurso para questão em figura/gráfico. */
export async function captura(): Promise<string> {
  const page = exigirPagina();
  const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
  return buf.toString('base64');
}

/** Dá um tempo para SPA/re-render assentarem depois de um clique. */
async function assentar(): Promise<void> {
  const page = exigirPagina();
  try {
    await page.waitForLoadState('networkidle', { timeout: 3000 });
  } catch {
    await page.waitForTimeout(400);
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

/**
 * Digita a credencial do cofre direto nos campos da página.
 *
 * Este é o ponto que justifica o MCP próprio em vez do @playwright/mcp genérico:
 * a senha sai do cofre, entra no Chromium e acaba ali. Ela não passa pelo prompt,
 * não vai para a trilha de passos e não aparece no instantâneo (campo `senha` é
 * relatado só como preenchido/vazio). O agente recebe de volta um booleano.
 */
export async function autenticar(
  credencialId: string,
  refUsuario?: string,
  refSenha?: string,
  refBotao?: string,
): Promise<{ ok: boolean; detalhe: string }> {
  const page = await abrir();
  const cred = await revelarParaNavegador(credencialId);
  if (!cred) return { ok: false, detalhe: 'credencial não encontrada no cofre' };

  const urlAntes = page.url();

  try {
    // Se o agente apontou os campos, usamos os refs dele. Senão, tentamos os
    // seletores que cobrem a esmagadora maioria das telas de login.
    const campoUsuario = refUsuario
      ? resolverRef(refUsuario).frame.locator(resolverRef(refUsuario).seletor).first()
      : page
          .locator(
            'input[type="email"], input[name*="user" i], input[id*="user" i], ' +
              'input[name*="login" i], input[id*="login" i], input[type="text"]',
          )
          .first();

    const campoSenha = refSenha
      ? resolverRef(refSenha).frame.locator(resolverRef(refSenha).seletor).first()
      : page.locator('input[type="password"]').first();

    await campoUsuario.fill(cred.usuario);
    await campoSenha.fill(cred.senha);

    if (refBotao) {
      const { frame, seletor } = resolverRef(refBotao);
      await frame.locator(seletor).first().click();
    } else {
      // Enter no campo de senha dispara o submit em praticamente todo form.
      await campoSenha.press('Enter');
    }

    await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);

    // Heurística de sucesso: ou a URL mudou, ou sumiu o campo de senha.
    const mudouUrl = page.url() !== urlAntes;
    const aindaTemSenha = (await page.locator('input[type="password"]').count()) > 0;
    const ok = mudouUrl || !aindaTemSenha;

    return {
      ok,
      detalhe: ok
        ? `login enviado como "${cred.usuario}"; agora em ${page.url()}`
        : 'os campos foram preenchidos e enviados, mas a tela de senha continua — ' +
          'credencial errada, ou há captcha/2FA esperando na janela',
    };
  } catch (err) {
    return { ok: false, detalhe: err instanceof Error ? err.message : String(err) };
  } finally {
    // Nada a limpar do lado do Node: `cred` sai de escopo e o valor só existiu
    // aqui dentro. O que importa é que ele nunca foi devolvido para cima.
  }
}
