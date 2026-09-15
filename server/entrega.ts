import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import {
  RAIZ_TRABALHOS, PASTA_NOTAS, ehInterno, listar, ler, revisarEntregaveis,
  type Suspeita,
} from './trabalhos';
import { listarZip } from './compactar';

/**
 * O painel de entrega: o que a aplicação SABE sobre os entregáveis, lido do
 * disco.
 *
 * Por que isto existe separado do relato do agente: o relato é o agente
 * contando o que acha que fez, em prosa. Isto é a aplicação conferindo — quais
 * arquivos existem mesmo, se o PDF é um PDF, o que está dentro do ZIP, se
 * sobrou recado interno na entrega. O dono precisa das duas coisas, e precisa
 * saber qual é qual: uma é julgamento, a outra é fato.
 *
 * Segue a regra de ouro nº 8 do projeto — só dado real. Nada aqui é inferido
 * do que o agente disse.
 */

export interface ArquivoEntrega {
  caminho: string;
  bytes: number;
  /** PDF cuja assinatura foi conferida byte a byte, não pelo nome. */
  pdfValido?: boolean;
}

export interface PacoteZip {
  caminho: string;
  bytes: number;
  itens: string[];
  /** Recado interno que vazou para dentro do pacote. Deve estar sempre vazio. */
  itensInternos: string[];
}

export interface Atividade {
  pasta: string;
  arquivos: ArquivoEntrega[];
  bytes: number;
  zip: PacoteZip | null;
  pdfs: ArquivoEntrega[];
  /** Trechos que parecem recado ao dono dentro dos arquivos desta atividade. */
  suspeitas: Suspeita[];
}

export interface Nota {
  atividade: string;
  conteudo: string;
}

export interface PainelEntrega {
  atividades: Atividade[];
  notas: Nota[];
  /** Somatório para o cabeçalho. */
  totais: { atividades: number; arquivos: number; bytes: number; zips: number; suspeitas: number };
  geradoEm: string;
}

/** Um PDF de verdade começa com `%PDF-`. Extensão não prova nada. */
async function pdfValido(rel: string): Promise<boolean> {
  try {
    const fd = await fs.open(join(RAIZ_TRABALHOS, rel), 'r');
    try {
      const buf = Buffer.alloc(5);
      await fd.read(buf, 0, 5, 0);
      return buf.toString('latin1') === '%PDF-';
    } finally {
      await fd.close();
    }
  } catch {
    return false;
  }
}

export async function montarPainel(): Promise<PainelEntrega> {
  const todos = await listar();
  const suspeitas = await revisarEntregaveis();

  // Os ZIPs ficam na raiz de trabalhos/, um por atividade.
  const zips = todos.filter((a) => a.caminho.toLowerCase().endsWith('.zip') && !a.caminho.includes('/'));

  const porPasta = new Map<string, typeof todos>();
  for (const a of todos) {
    if (ehInterno(a.caminho)) continue;
    const [pasta, ...resto] = a.caminho.split('/');
    if (!resto.length) continue; // arquivo solto na raiz (os ZIPs) — tratado à parte
    if (!porPasta.has(pasta)) porPasta.set(pasta, []);
    porPasta.get(pasta)!.push(a);
  }

  const atividades: Atividade[] = [];
  for (const [pasta, arquivos] of porPasta) {
    const comPdf: ArquivoEntrega[] = [];
    const lista: ArquivoEntrega[] = [];

    for (const a of arquivos) {
      const item: ArquivoEntrega = { caminho: a.caminho, bytes: a.bytes };
      if (a.caminho.toLowerCase().endsWith('.pdf')) {
        item.pdfValido = await pdfValido(a.caminho);
        comPdf.push(item);
      }
      lista.push(item);
    }

    // O ZIP desta atividade: o mais recente que tenha sido gerado a partir dela.
    // Casamos pelo conteúdo, não pelo nome, porque o nome exigido pelo professor
    // (GRUPO_16.zip) não tem relação com o nome da pasta.
    let zip: PacoteZip | null = null;
    for (const z of zips) {
      const itens = await listarZip(z.caminho);
      if (!itens.length) continue;
      const nomesDaPasta = new Set(arquivos.map((a) => a.caminho.slice(pasta.length + 1)));
      const bate = itens.some((i) => nomesDaPasta.has(i.replace(/\\/g, '/')));
      if (!bate) continue;
      zip = {
        caminho: z.caminho,
        bytes: z.bytes,
        itens,
        itensInternos: itens.filter((i) => ehInterno(i.replace(/\\/g, '/'))),
      };
      break;
    }

    atividades.push({
      pasta,
      arquivos: lista,
      bytes: lista.reduce((s, a) => s + a.bytes, 0),
      zip,
      pdfs: comPdf,
      suspeitas: suspeitas.filter((s) => s.caminho.startsWith(`${pasta}/`)),
    });
  }

  atividades.sort((a, b) => a.pasta.localeCompare(b.pasta));

  const notas: Nota[] = [];
  for (const a of todos) {
    if (!a.caminho.startsWith(`${PASTA_NOTAS}/`)) continue;
    notas.push({
      atividade: a.caminho.slice(PASTA_NOTAS.length + 1).replace(/\.md$/, ''),
      conteudo: await ler(a.caminho).catch(() => ''),
    });
  }

  return {
    atividades,
    notas,
    totais: {
      atividades: atividades.length,
      arquivos: atividades.reduce((s, a) => s + a.arquivos.length, 0),
      bytes: atividades.reduce((s, a) => s + a.bytes, 0),
      zips: atividades.filter((a) => a.zip).length,
      suspeitas: suspeitas.length,
    },
    geradoEm: new Date().toISOString(),
  };
}
