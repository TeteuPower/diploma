import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolverCaminho } from './trabalhos';
import { log, cronometro } from './log';

/**
 * HTML → PDF pelo próprio Chromium.
 *
 * Por que isto existe: atividade acadêmica quase sempre exige **PDF**, e um
 * agente que só produz `.md` e `.sql` entrega meio trabalho — sobra para o dono
 * a parte chata de formatar. O Chromium do Playwright já está instalado e sabe
 * imprimir; puxar uma biblioteca de PDF seria dependência nova para resolver
 * algo que já temos em casa.
 *
 * O navegador aqui é **descartável e à parte** do que opera o LMS. Dois
 * motivos: `page.pdf()` só funciona em headless, e a janela do LMS roda com
 * cabeça para o dono acompanhar; e não se carrega um arquivo local no mesmo
 * contexto que guarda o cookie de sessão da faculdade.
 */
export async function gerarPdf(
  htmlRelativo: string,
  pdfRelativo: string,
  opcoes: { paisagem?: boolean } = {},
): Promise<{ bytes: number }> {
  const origem = resolverCaminho(htmlRelativo);
  const destino = resolverCaminho(pdfRelativo);
  const medir = cronometro();

  const navegador = await chromium.launch({ headless: true });
  try {
    const pagina = await navegador.newPage();
    // file:// para o HTML poder referenciar imagem/CSS da própria pasta.
    await pagina.goto(pathToFileURL(origem).href, { waitUntil: 'networkidle', timeout: 30000 });
    await pagina.pdf({
      path: destino,
      format: 'A4',
      landscape: Boolean(opcoes.paisagem),
      printBackground: true,
      margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' },
    });
  } finally {
    await navegador.close();
  }

  const { statSync } = await import('node:fs');
  const bytes = statSync(destino).size;
  log('pdf', 'gerado', { de: htmlRelativo, para: pdfRelativo, bytes, ms: medir() });
  return { bytes };
}
