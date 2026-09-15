/**
 * A pasta `trabalhos/` é uma fronteira de segurança: o agente escreve nela e
 * em nada mais. Fuga de caminho é o jeito clássico de furar isso, então cada
 * variação que eu conheço entra aqui.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import * as t from '../server/trabalhos';

let falhas = 0;
const checa = (nome: string, ok: boolean, extra = '') => {
  console.log(`${ok ? '  ok  ' : '  FALHA'} ${nome}${extra ? ` — ${extra}` : ''}`);
  if (!ok) falhas += 1;
};

async function recusa(nome: string, caminho: string) {
  try {
    await t.escrever(caminho, 'invasao');
    checa(nome, false, `ACEITOU "${caminho}" — isso é fuga da pasta`);
  } catch {
    checa(nome, true, caminho);
  }
}

await t.initTrabalhos();

console.log('Fuga de caminho (tem que recusar):');
await recusa('recusa ..', '../fora.txt');
await recusa('recusa .. no meio', 'ok/../../fora.txt');
await recusa('recusa .. repetido', '../../../../../../Windows/Temp/fora.txt');
await recusa('recusa absoluto unix', '/etc/passwd');
await recusa('recusa absoluto windows', 'C:/Windows/Temp/fora.txt');
await recusa('recusa barra invertida', '..\\..\\fora.txt');
await recusa('recusa vazio', '   ');
await recusa('recusa caractere de controle', 'ok/ar\u0000quivo.txt');

console.log('\nCaminho legítimo (tem que aceitar):');
try {
  const { bytes } = await t.escrever('teste-prova/consultas.sql', 'SELECT 1;\n');
  checa('escreve na raiz da pasta', bytes === 10, `${bytes} bytes`);

  await t.escrever('teste-prova/sub/nested/LEIA.md', '# doc\n');
  checa('cria subpasta aninhada', true);

  const lido = await t.ler('teste-prova/consultas.sql');
  checa('lê de volta o que escreveu', lido === 'SELECT 1;\n');

  await t.escrever('teste-prova/consultas.sql', 'SELECT 2;\n');
  checa('substitui, não acrescenta', (await t.ler('teste-prova/consultas.sql')) === 'SELECT 2;\n');

  const itens = await t.listar('teste-prova');
  checa('lista os dois arquivos', itens.length === 2, itens.map((i) => i.caminho).join(', '));
  checa(
    'caminhos listados são relativos e com /',
    itens.every((i) => !i.caminho.includes('\\') && !i.caminho.startsWith('/')),
  );

  const bin = Buffer.from([0x25, 0x50, 0x44, 0x46]);
  await t.gravarBinario('teste-prova/anexo.pdf', bin);
  const noDisco = await fs.readFile(join(t.RAIZ_TRABALHOS, 'teste-prova', 'anexo.pdf'));
  checa('grava binário sem corromper', noDisco.equals(bin));

  checa('apaga o que existe', await t.apagar('teste-prova/anexo.pdf'));
  checa('apagar inexistente devolve false', !(await t.apagar('teste-prova/nao-existe.txt')));

  // Teto de tamanho: sem isso, um loop de escrita enche o disco calado.
  let barrou = false;
  await t.escrever('teste-prova/gigante.txt', 'x'.repeat(3 * 1024 * 1024)).catch(() => {
    barrou = true;
  });
  checa('recusa arquivo acima do teto', barrou);
} catch (err) {
  checa('bloco legítimo sem exceção', false, String(err));
} finally {
  await fs.rm(join(t.RAIZ_TRABALHOS, 'teste-prova'), { recursive: true, force: true });
}

// O recado ao dono não pode viajar junto com a entrega: ele é escrito para
// quem revisa, e chegaria ao professor se ficasse dentro da pasta.
console.log('\nSeparação entre entrega e recado ao dono:');
try {
  await recusa('recusa escrever em pasta com prefixo _', '_notas/na-marra.md');
  await recusa('recusa prefixo _ em subpasta', 'atividade/_rascunho/nota.md');

  const rel = await t.notaParaDono('atividade x!', '# Pendências\n- confirme com o grupo\n');
  checa('nota vai para _notas/', rel === '_notas/atividade-x.md', rel);
  checa('nome da nota é higienizado', !/[^A-Za-z0-9._/-]/.test(rel));

  await t.escrever('entrega-prova/consultas.sql', 'SELECT 1 FROM dual;\n');
  await t.escrever('entrega-prova/doc.md', '# Modelo\nTabela T_X com colunas A e B.\n');
  let suspeitas = await t.revisarEntregaveis();
  const naEntrega = suspeitas.filter((s) => s.caminho.startsWith('entrega-prova/'));
  checa('entrega limpa não gera suspeita', naEntrega.length === 0, `${naEntrega.length}`);
  checa(
    'a nota em _notas NÃO é acusada',
    !suspeitas.some((s) => s.caminho.startsWith('_notas/')),
  );

  // Agora o caso que o dono teme: recado embutido no meio do documento.
  await t.escrever('entrega-prova/doc.md', '# Modelo\n\nAVISO IMPORTANTE: confirme com o grupo.\n');
  suspeitas = await t.revisarEntregaveis();
  checa(
    'acusa recado embutido no entregável',
    suspeitas.some((s) => s.caminho === 'entrega-prova/doc.md'),
  );

  // E o ZIP não pode levar nada interno junto.
  const { compactar } = await import('../server/compactar');
  await t.escrever('entrega-prova/extra.txt', 'conteudo\n');
  await fs.mkdir(join(t.RAIZ_TRABALHOS, 'entrega-prova', '_interno'), { recursive: true });
  await fs.writeFile(join(t.RAIZ_TRABALHOS, 'entrega-prova', '_interno', 'recado.md'), 'nao enviar');
  await compactar('entrega-prova', 'entrega-prova.zip');
  const zip = await fs.readFile(join(t.RAIZ_TRABALHOS, 'entrega-prova.zip'));
  // Nome de arquivo aparece em claro no índice do ZIP, então basta procurar.
  checa('ZIP NÃO inclui pasta com prefixo _', !zip.includes(Buffer.from('_interno')));
  checa('ZIP inclui o entregável de verdade', zip.includes(Buffer.from('consultas.sql')));
} catch (err) {
  checa('bloco de separação sem exceção', false, String(err));
} finally {
  await fs.rm(join(t.RAIZ_TRABALHOS, 'entrega-prova'), { recursive: true, force: true });
  await fs.rm(join(t.RAIZ_TRABALHOS, 'entrega-prova.zip'), { force: true });
  await fs.rm(join(t.RAIZ_TRABALHOS, '_notas', 'atividade-x.md'), { force: true });
}

console.log(`\n${falhas === 0 ? '✅ tudo passou' : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
