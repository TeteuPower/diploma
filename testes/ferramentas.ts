/**
 * O servidor MCP precisa responder `tools/list` — senão ele cai INTEIRO e o
 * agente fica sem navegador, caindo no toolset padrão do Claude Code. Foi
 * exatamente o que aconteceu quando um schema com `z.record` entrou: nenhuma
 * exceção no boot, nenhum erro no log, e uma sessão web "concluída" sem uma
 * única ferramenta chamada. Este teste é o alarme que faltou.
 */
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { criarServidorLms, FERRAMENTAS_LMS, SERVIDOR_MCP } from '../server/ferramentas';
import { initStore } from '../server/store';
import { initCofre } from '../server/cofre';

let falhas = 0;
const checa = (nome: string, ok: boolean, extra = '') => {
  console.log(`${ok ? '  ok  ' : '  FALHA'} ${nome}${extra ? ` — ${extra}` : ''}`);
  if (!ok) falhas += 1;
};

type Servidor = { instance: { connect: (t: unknown) => Promise<void> } };

async function listar(servidor: Servidor): Promise<string[] | Error> {
  const [cli, srv] = InMemoryTransport.createLinkedPair();
  await servidor.instance.connect(srv);
  const client = new Client({ name: 'teste', version: '0' });
  await client.connect(cli);
  try {
    return (await client.listTools()).tools.map((t) => t.name);
  } catch (e) {
    return e instanceof Error ? e : new Error(String(e));
  } finally {
    await client.close().catch(() => {});
  }
}

await initStore();
await initCofre();

console.log('Servidor MCP do Diploma:');
const nomes = await listar(criarServidorLms('teste') as unknown as Servidor);
if (nomes instanceof Error) {
  checa('tools/list responde', false, nomes.message);
} else {
  checa('tools/list responde', true, `${nomes.length} ferramentas`);
  const esperadas = FERRAMENTAS_LMS.map((n) => n.replace(`mcp__${SERVIDOR_MCP}__`, ''));
  const faltando = esperadas.filter((n) => !nomes.includes(n));
  checa('todas as ferramentas declaradas estão expostas', faltando.length === 0, faltando.join(', ') || 'nenhuma faltando');
  const sobrando = nomes.filter((n) => !esperadas.includes(n));
  checa('nenhuma ferramenta exposta fora da lista permitida', sobrando.length === 0, sobrando.join(', ') || 'nenhuma sobrando');
  for (const critica of ['abrir', 'clicar', 'registrar_achado', 'buscar_web', 'perguntar']) {
    checa(`expõe ${critica}`, nomes.includes(critica));
  }
}

// Canário: hoje `z.record` derruba tools/list no SDK. Se um dia isto passar a
// dar "ok", o SDK consertou — e a gambiarra de lista de pares pode voltar a
// ser um objeto. Até lá, ninguém pode reintroduzir record sem este aviso.
console.log('\nCanário do z.record:');
const vazio = async () => ({ content: [{ type: 'text' as const, text: 'x' }] });
const comRecord = createSdkMcpServer({
  name: 'canario',
  version: '0',
  tools: [tool('t', 'd', { d: z.record(z.string(), z.string()) } as never, vazio as never)],
}) as unknown as Servidor;
const r = await listar(comRecord);
checa(
  'z.record AINDA quebra o SDK (se passou, revise o comentário em registrar_achado)',
  r instanceof Error,
  r instanceof Error ? r.message.slice(0, 70) : 'passou — SDK consertou?',
);

console.log(`\n${falhas === 0 ? '✅ tudo passou' : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
