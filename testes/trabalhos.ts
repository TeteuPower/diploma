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

console.log(`\n${falhas === 0 ? '✅ tudo passou' : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
