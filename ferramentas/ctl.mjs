#!/usr/bin/env node
/**
 * ctl — o canal de controle da aplicação por fora da interface.
 *
 * A UI existe para o dono. Isto existe para quem está desenvolvendo: observar o
 * turno ao vivo, interromper, retomar, aprovar e ler o log cru sem tirar a mão
 * do terminal. Fala com a mesma API REST que a interface usa, então não há
 * caminho paralelo nem estado duplicado — o que passa por aqui passa pelas
 * mesmas travas.
 *
 * Uso:
 *   node ferramentas/ctl.mjs status
 *   node ferramentas/ctl.mjs log [n] [filtro]
 *   node ferramentas/ctl.mjs seguir [filtro]     # acompanha ao vivo
 *   node ferramentas/ctl.mjs nova "<objetivo>" [--lms|--web] [--aberto|--lista=a.com,b.com]
 *   node ferramentas/ctl.mjs achados [id]          # o que ele encontrou, com fonte
 *   node ferramentas/ctl.mjs brave chave <k> | pais <BR> | testar | remover
 *   node ferramentas/ctl.mjs passos [id] [n]
 *   node ferramentas/ctl.mjs pendente
 *   node ferramentas/ctl.mjs aprovar [observação]
 *   node ferramentas/ctl.mjs recusar [motivo]
 *   node ferramentas/ctl.mjs parar [id]
 *   node ferramentas/ctl.mjs retomar [id]
 *   node ferramentas/ctl.mjs apagar <id>
 *   node ferramentas/ctl.mjs config [chave=valor ...]
 *   node ferramentas/ctl.mjs tentativas [--zerar <quiz>]
 */
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(dirname(fileURLToPath(import.meta.url)));
const LOG = join(RAIZ, 'data', 'diploma.log');
const BASE = `http://localhost:${process.env.DIPLOMA_PORT ?? 8980}`;

const [, , comando = 'status', ...resto] = process.argv;

async function api(rota, init) {
  const res = await fetch(`${BASE}/api${rota}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const corpo = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${rota}: ${corpo.slice(0, 400)}`);
  return corpo ? JSON.parse(corpo) : null;
}

/** A sessão "de trabalho": a que está viva, ou a mais recente. */
async function sessaoAtual(id) {
  const todas = await api('/sessoes');
  if (id) return todas.find((s) => s.id === id) ?? null;
  return (
    todas.find((s) => s.status === 'aguardando') ??
    todas.find((s) => s.status === 'rodando') ??
    todas[0] ??
    null
  );
}

const cortar = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? '');

function pintarLinha(l) {
  if (l.includes(' ERRO ')) return `\x1b[31m${l}\x1b[0m`;
  if (l.includes(' AVISO')) return `\x1b[33m${l}\x1b[0m`;
  if (l.includes('[portao]')) return `\x1b[36m${l}\x1b[0m`;
  if (l.includes('[ferramenta] →')) return `\x1b[35m${l}\x1b[0m`;
  return l;
}

function lerLog(n, filtro) {
  if (!existsSync(LOG)) return [];
  const linhas = readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
  const filtradas = filtro ? linhas.filter((l) => l.toLowerCase().includes(filtro.toLowerCase())) : linhas;
  return filtradas.slice(-n);
}

/** Acompanha o arquivo a partir do fim, imprimindo o que for chegando. */
function seguir(filtro) {
  let pos = existsSync(LOG) ? statSync(LOG).size : 0;
  console.log(`— seguindo ${LOG}${filtro ? ` (filtro: ${filtro})` : ''}. Ctrl+C para sair —`);
  setInterval(() => {
    if (!existsSync(LOG)) return;
    const tam = statSync(LOG).size;
    if (tam < pos) pos = 0; // rotacionou
    if (tam === pos) return;
    const fluxo = createReadStream(LOG, { start: pos, end: tam - 1, encoding: 'utf8' });
    let buf = '';
    fluxo.on('data', (d) => (buf += d));
    fluxo.on('end', () => {
      pos = tam;
      for (const l of buf.split('\n').filter(Boolean)) {
        if (!filtro || l.toLowerCase().includes(filtro.toLowerCase())) console.log(pintarLinha(l));
      }
    });
  }, 400);
}

function mostrarPendente(s) {
  if (!s?.pendente) return false;
  const p = s.pendente;
  console.log(`\n\x1b[33m⏸  APROVAÇÃO PENDENTE\x1b[0m  (${p.acao})`);
  console.log(`   ${p.descricao}`);
  console.log(`   ${p.url}`);
  console.log('   ─── o que vai acontecer ───');
  for (const l of (p.detalhe || '(sem detalhe)').split('\n')) console.log(`   ${l}`);
  console.log(`\n   responda: ctl aprovar  |  ctl recusar "<motivo>"`);
  return true;
}

try {
  switch (comando) {
    case 'status': {
      const [saude, sessoes] = await Promise.all([api('/health'), api('/sessoes')]);
      console.log(
        `servidor ok · auth=${saude.auth} · cofre=${saude.cofre.disponivel ? `ok(${saude.cofre.total})` : 'OFF'}` +
          ` · chromium=${saude.navegador.instalado ? 'ok' : 'FALTA'} · janela=${saude.navegador.aberto ? 'aberta' : 'fechada'}`,
      );
      const cfg = await api('/config');
      console.log(
        `alvo=${cfg.alvo.urlBase || '(nenhum)'} · modo=${cfg.modo} · tentativasPorQuiz=${cfg.tentativasPorQuiz} · maxPassos=${cfg.navegador.maxPassos}`,
      );
      console.log('');
      for (const s of sessoes.slice(0, 6)) {
        console.log(
          `${s.status === 'rodando' ? '▶' : s.status === 'aguardando' ? '⏸' : '·'} ${s.id}  ` +
            `${s.status.padEnd(12)} ${String(s.passos.length).padStart(3)} passos  ${cortar(s.objetivo, 70)}`,
        );
      }
      mostrarPendente(sessoes.find((s) => s.pendente));
      break;
    }

    case 'log': {
      const n = Number(resto[0]) || 60;
      for (const l of lerLog(n, resto[1])) console.log(pintarLinha(l));
      break;
    }

    case 'seguir':
      seguir(resto[0]);
      break;

    case 'nova': {
      // Flags saem do texto; o que sobra é o objetivo.
      let missao = 'lms';
      let dominios;
      const palavras = [];
      for (const w of resto) {
        if (w === '--web') missao = 'web';
        else if (w === '--lms') missao = 'lms';
        else if (w === '--aberto') dominios = { modo: 'aberto', hosts: [] };
        else if (w.startsWith('--lista=')) dominios = { modo: 'lista', hosts: w.slice(8).split(',').filter(Boolean) };
        else palavras.push(w);
      }
      const objetivo = palavras.join(' ').trim();
      if (!objetivo) throw new Error('faltou o objetivo');
      const s = await api('/sessoes', {
        method: 'POST',
        body: JSON.stringify({ objetivo, missao, dominios }),
      });
      console.log(
        `criada ${s.id} · ${s.missao} · domínios ${s.dominios.modo}` +
          (s.dominios.hosts.length ? ` (${s.dominios.hosts.join(', ')})` : '') +
          `\nobjetivo: ${s.objetivo}`,
      );
      break;
    }

    case 'achados': {
      const id = resto[0]?.startsWith('ses-') ? resto[0] : (await sessaoAtual())?.id;
      const lista = await api(`/achados${id ? `?sessao=${id}` : ''}`);
      if (!lista.length) {
        console.log('nenhum achado' + (id ? ` na sessão ${id}` : ''));
        break;
      }
      const porTipo = {};
      for (const a of lista) (porTipo[a.tipo] ??= []).push(a);
      for (const [tipo, itens] of Object.entries(porTipo)) {
        console.log(`\n${tipo.toUpperCase()} (${itens.length})`);
        const ordenados =
          tipo === 'produto'
            ? [...itens].sort((x, y) => (Number(x.dados.preco) || Infinity) - (Number(y.dados.preco) || Infinity))
            : itens;
        for (const a of ordenados) {
          const preco = tipo === 'produto' && a.dados.preco != null ? `R$ ${a.dados.preco}  ` : '';
          console.log(`  ${preco}${a.titulo}  [${a.confianca}]`);
          console.log(`     ${cortar(a.resumo, 140)}`);
          console.log(`     ${a.fonte}`);
        }
      }
      break;
    }

    case 'brave': {
      const [sub, ...args] = resto;
      if (sub === 'chave') {
        const chave = args.join(' ').trim();
        if (!chave) throw new Error('faltou a chave');
        await api('/brave/chave', { method: 'POST', body: JSON.stringify({ chave }) });
        console.log('chave guardada no cofre');
      } else if (sub === 'pais') {
        await api('/config', { method: 'PATCH', body: JSON.stringify({ brave: { pais: args[0] ?? '' } }) });
        console.log(`país: ${args[0] ?? '(global)'}`);
      } else if (sub === 'remover') {
        await api('/brave/chave', { method: 'DELETE' });
        console.log('chave removida');
      } else if (sub === 'testar') {
        const r = await api('/brave/testar', { method: 'POST' });
        console.log(r.ok ? `\x1b[32mok\x1b[0m: ${r.detalhe}` : `\x1b[31mfalhou\x1b[0m: ${r.detalhe}`);
        for (const a of r.amostra ?? []) console.log(`  - ${a.titulo}\n    ${a.url}`);
      } else {
        console.log(JSON.stringify(await api('/brave'), null, 2));
      }
      break;
    }

    case 'passos': {
      const id = resto[0]?.startsWith('ses-') ? resto[0] : undefined;
      const n = Number(id ? resto[1] : resto[0]) || 30;
      const s = await sessaoAtual(id);
      if (!s) throw new Error('nenhuma sessão');
      console.log(`${s.id} · ${s.status} · modo ${s.modo}`);
      console.log(`objetivo: ${s.objetivo}`);
      console.log(`url: ${s.urlAtual ?? '—'}\n`);
      for (const p of s.passos.slice(-n)) {
        const hora = new Date(p.at).toLocaleTimeString('pt-BR');
        console.log(`${hora} ${p.tipo.padEnd(9)} ${(p.ferramenta ?? '').padEnd(9)} ${cortar(p.resumo, 180)}`);
      }
      if (s.resultado) console.log(`\n── relato final ──\n${s.resultado}`);
      mostrarPendente(s);
      break;
    }

    case 'pendente': {
      const s = await sessaoAtual();
      if (!mostrarPendente(s)) console.log('nada pendente');
      break;
    }

    case 'aprovar':
    case 'recusar': {
      const s = await sessaoAtual();
      if (!s?.pendente) throw new Error('não há aprovação pendente');
      await api(`/sessoes/${s.id}/aprovacao`, {
        method: 'POST',
        body: JSON.stringify({
          pedidoId: s.pendente.id,
          aprovado: comando === 'aprovar',
          motivo: resto.join(' '),
        }),
      });
      console.log(`${comando === 'aprovar' ? '✅ aprovado' : '🛑 recusado'}: ${s.pendente.descricao}`);
      break;
    }

    case 'parar': {
      const s = await sessaoAtual(resto[0]);
      if (!s) throw new Error('nenhuma sessão');
      console.log(await api(`/sessoes/${s.id}/parar`, { method: 'POST' }));
      break;
    }

    case 'retomar': {
      const s = await sessaoAtual(resto[0]);
      if (!s) throw new Error('nenhuma sessão');
      await api(`/sessoes/${s.id}/retomar`, { method: 'POST' });
      console.log(`retomando ${s.id}`);
      break;
    }

    case 'apagar':
      await api(`/sessoes/${resto[0]}`, { method: 'DELETE' });
      console.log('apagada');
      break;

    case 'config': {
      if (!resto.length) {
        console.log(JSON.stringify(await api('/config'), null, 2));
        break;
      }
      const patch = {};
      for (const par of resto) {
        const [k, ...v] = par.split('=');
        const bruto = v.join('=');
        let valor = bruto;
        if (bruto === 'true') valor = true;
        else if (bruto === 'false') valor = false;
        else if (bruto !== '' && !Number.isNaN(Number(bruto))) valor = Number(bruto);
        // Chave aninhada: navegador.headless=true
        if (k.includes('.')) {
          const [pai, filho] = k.split('.');
          const atual = await api('/config');
          patch[pai] = { ...atual[pai], [filho]: valor };
        } else {
          patch[k] = valor;
        }
      }
      console.log(JSON.stringify(await api('/config', { method: 'PATCH', body: JSON.stringify(patch) }), null, 2));
      break;
    }

    case 'olhar': {
      // O instantâneo cru da página aberta — o que o agente está vendo agora.
      const r = await fetch(`${BASE}/api/debug/instantaneo`);
      const t = await r.text();
      if (resto[0]) {
        const f = resto[0].toLowerCase();
        const casaram = t.split('\n').filter((l) => l.toLowerCase().includes(f));
        console.log(casaram.length ? casaram.join('\n') : '(nada casou)');
      } else {
        console.log(t);
      }
      break;
    }

    case 'revisar': {
      // O que vai para o professor, e o que ainda tem recado ao dono embutido.
      const { arquivos, suspeitas } = await api('/revisao');
      const porPasta = {};
      for (const a of arquivos) {
        const pasta = a.caminho.split('/')[0];
        porPasta[pasta] = (porPasta[pasta] ?? 0) + 1;
      }
      console.log('ENTREGAVEIS');
      for (const [pasta, n] of Object.entries(porPasta)) {
        const interna = pasta.startsWith('_');
        console.log(`  ${interna ? '(interno) ' : ''}${pasta}: ${n} arquivo(s)`);
      }
      console.log('');
      if (!suspeitas.length) {
        console.log('[32mLIMPO[0m: nenhum recado ao dono dentro dos entregaveis.');
      } else {
        console.log(`[33m${suspeitas.length} trecho(s) suspeitos DENTRO da entrega:[0m`);
        for (const s of suspeitas) console.log(`  ${s.caminho}:${s.linha}  ${s.trecho}`);
      }
      break;
    }

    case 'tentativas': {
      if (resto[0] === '--zerar') {
        await api(`/tentativas/${encodeURIComponent(resto[1])}`, { method: 'DELETE' });
        console.log('registro zerado');
        break;
      }
      const regs = await api('/tentativas');
      if (!regs.length) console.log('nenhuma tentativa registrada');
      for (const r of regs) {
        console.log(`${r.tentativas.length}x  ${r.quiz}\n     ${r.url}\n     ids: ${r.tentativas.join(', ')}`);
      }
      break;
    }

    default:
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  }
} catch (err) {
  console.error(`\x1b[31merro:\x1b[0m ${err.message}`);
  process.exit(1);
}
