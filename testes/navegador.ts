/**
 * Prova de fogo do instantâneo: sobe um LMS falso (com iframe, radio, select,
 * textarea e campo de senha) e confere que o agente enxergaria o suficiente
 * para responder — e que a senha NÃO vaza para o instantâneo.
 */
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { PATHS, DATA_DIR } from '../server/env';

const QUIZ = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Módulo 3 — Questionário</title></head>
<body>
  <h1>Segurança da Informação</h1>
  <h2>Questionário do módulo 3</h2>
  <form id="q">
    <fieldset>
      <legend>1. O que caracteriza um ataque de phishing?</legend>
      <label><input type="radio" name="q1" value="a"> Explorar falha de buffer overflow</label>
      <label><input type="radio" name="q1" value="b"> Enganar a pessoa para que ela entregue dados</label>
      <label><input type="radio" name="q1" value="c"> Sobrecarregar o servidor com requisições</label>
    </fieldset>
    <fieldset>
      <legend>2. Selecione o protocolo seguro:</legend>
      <select name="q2" id="q2">
        <option value="">-- escolha --</option>
        <option value="http">HTTP</option>
        <option value="https">HTTPS</option>
        <option value="ftp">FTP</option>
      </select>
    </fieldset>
    <fieldset>
      <legend>3. Justifique sua resposta:</legend>
      <textarea name="q3" id="q3" rows="3" placeholder="Sua justificativa"></textarea>
    </fieldset>
    <label for="conf">Confirmo que revisei</label>
    <input type="checkbox" id="conf" name="conf">
    <button type="button" id="enviar">Finalizar tentativa</button>
  </form>

  <!-- O padrão que travou no quiz da FIAP: alternativa é um card e o radio de
       verdade está escondido. As três formas de esconder que se vê na prática. -->
  <input type="hidden" name="csrf" value="tok123">
  <fieldset id="cards">
    <legend>4. Para que serve o padrão DAO?</legend>
    <label class="card"><input type="radio" name="q4" value="a" style="opacity:0;position:absolute"> Para renderizar a interface do usuário</label>
    <label class="card"><input type="radio" name="q4" value="b" style="width:0;height:0"> Fornece uma abstração da camada de acesso a dados</label>
    <label class="card" for="q4c">Para cifrar o tráfego de rede</label>
    <input type="radio" name="q4" value="c" id="q4c" style="display:none">
  </fieldset>
  <!-- Inalcançáveis: têm caixa e passam em "visível", mas clicar neles trava o
       Playwright até estourar o prazo. Foi o que queimou um turno num "X" de
       painel de anotações fechado. -->
  <a href="#" id="fora-esquerda" style="position:absolute;left:-9999px">Fechar painel lateral</a>
  <div style="overflow:hidden;width:200px;height:40px;position:relative">
    <a href="#" id="recortado" style="position:absolute;left:400px">Botao do painel deslizante</a>
  </div>
  <a href="#" id="fixo-fora" style="position:fixed;left:-500px;top:10px">Menu fixo escondido</a>
  <a href="#" id="alcancavel-abaixo">Link la embaixo mas alcancavel</a>

  <p style="display:none">Este texto invisível NÃO pode aparecer</p>
  <iframe src="/embutido" title="Conteúdo SCORM" width="600" height="200"></iframe>
</body></html>`;

const EMBUTIDO = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"></head><body>
  <h3>Vídeo-aula 3.2</h3>
  <p>Conteúdo interativo do módulo.</p>
  <button id="marcar">Marcar como assistido</button>
</body></html>`;

const LOGIN = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Entrar</title></head><body>
  <h1>Acesso ao AVA</h1>
  <form method="GET" action="/curso">
    <label for="u">Usuário</label><input id="u" name="u" type="text">
    <label for="p">Senha</label><input id="p" name="p" type="password">
    <button type="submit">Entrar</button>
  </form>
</body></html>`;

const servidor = createServer((req, res) => {
  const rota = (req.url ?? '/').split('?')[0];
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (rota === '/embutido') return res.end(EMBUTIDO);
  if (rota === '/login') return res.end(LOGIN);
  return res.end(QUIZ);
});

await new Promise<void>((r) => servidor.listen(9099, r));
console.log('LMS falso em http://localhost:9099\n');

// Aponta o alvo para o LMS falso ANTES de importar o navegador (ele lê a config).
await fs.mkdir(DATA_DIR, { recursive: true });
const cfgBruta = await fs.readFile(PATHS.config, 'utf8').catch(() => '{}');
const cfg = JSON.parse(cfgBruta);
const backup = JSON.stringify(cfg);
cfg.alvo = { nome: 'LMS de teste', urlBase: 'http://localhost:9099', caminhoLogin: '/login' };
cfg.navegador = { ...(cfg.navegador ?? {}), headless: true, perfilPersistente: false, timeoutMs: 10000, maxPassos: 80, timeoutAprovacaoS: 600 };
cfg.modo = 'autonomo';
await fs.writeFile(PATHS.config, JSON.stringify(cfg, null, 2));

const { initStore } = await import('../server/store');
await initStore();
const nav = await import('../server/navegador');

let falhas = 0;
const checa = (nome: string, ok: boolean, extra = '') => {
  console.log(`${ok ? '  ok  ' : '  FALHA'} ${nome}${extra ? ` — ${extra}` : ''}`);
  if (!ok) falhas += 1;
};

try {
  // --- A fronteira de domínio ---
  console.log('Fronteira de domínio:');
  checa('aceita o alvo', nav.dentroDoAlvo('http://localhost:9099/curso'));
  checa('recusa outro host', !nav.dentroDoAlvo('https://google.com/'));
  let recusou = false;
  await nav.navegar('https://example.com').catch(() => { recusou = true; });
  checa('navegar() recusa fora do alvo', recusou);

  // --- Instantâneo do quiz ---
  console.log('\nInstantâneo do quiz:');
  await nav.navegar('/curso');
  const snap = await nav.instantaneo();

  checa('traz o enunciado da questão 1', snap.includes('phishing'));
  checa('traz as 3 alternativas', (snap.match(/radio /g) ?? []).length >= 3);
  checa('alternativas têm ref', /radio .*ref=e\d+/.test(snap));
  checa('mostra estado desmarcado', snap.includes('desmarcado'));
  checa('traz as opções do select', snap.includes('HTTPS'));
  checa('traz a textarea', snap.includes('area-texto') || snap.includes('justificativa'));
  checa('traz o botão de envio', snap.includes('Finalizar tentativa'));
  checa('OMITE o texto invisível', !snap.includes('NÃO pode aparecer'));
  checa('entra no iframe', snap.includes('Marcar como assistido'), 'conteúdo SCORM');
  checa('ref do iframe tem prefixo f', /ref=f\d+e\d+/.test(snap));

  // --- Agir pelos refs ---
  console.log('\nAções pelos refs:');
  const refRadioB = /radio "[^"]*entregue dados"[^\n]*ref=(e\d+)/.exec(snap)?.[1]
    ?? /radio "[^"]*Enganar[^"]*"[^\n]*ref=(e\d+)/.exec(snap)?.[1];
  checa('achou o ref da alternativa correta', Boolean(refRadioB), refRadioB ?? 'não achou');
  if (refRadioB) {
    await nav.marcar(refRadioB, true);
    const depois = await nav.instantaneo();
    checa('a alternativa ficou marcada', /radio "[^"]*(?:entregue dados|Enganar)[^"]*"[^\n]*\[marcado/.test(depois));
  }

  const refSelect = /lista "[^"]*"[^\n]*ref=(e\d+)/.exec(snap)?.[1];
  if (refSelect) {
    await nav.selecionar(refSelect, 'https');
    const depois = await nav.instantaneo();
    checa('o select guardou HTTPS', depois.includes('"HTTPS" valor="https" [selecionado]'));
  } else {
    checa('achou o ref do select', false);
  }

  const refArea = /area-texto[^\n]*ref=(e\d+)/.exec(snap)?.[1];
  if (refArea) {
    await nav.preencher(refArea, 'HTTPS cifra o transporte.');
    const depois = await nav.instantaneo();
    checa('a textarea guardou o texto', depois.includes('HTTPS cifra o transporte'));
  } else {
    checa('achou o ref da textarea', false);
  }

  const refIframe = /ref=(f\d+e\d+)/.exec(snap)?.[1];
  if (refIframe) {
    let clicou = true;
    await nav.clicar(refIframe).catch(() => { clicou = false; });
    checa('clica dentro do iframe', clicou, refIframe);
  }

  // --- Alternativa como card, com o radio escondido (o caso da FIAP) ---
  console.log('\nAlternativa como card (radio escondido):');
  await nav.navegar('/curso');
  const cards = await nav.instantaneo();

  const comRef = (trecho: string) =>
    new RegExp('radio "[^"]*' + trecho + '[^"]*"[^\\n]*ref=(e\\d+)').exec(cards)?.[1];

  const refOpacity = comRef('renderizar a interface');
  const refTamanho = comRef('abstração da camada');
  const refDisplay = comRef('cifrar o tráfego');

  checa('acha o card com radio opacity:0', Boolean(refOpacity), refOpacity ?? 'sem ref');
  checa('acha o card com radio de tamanho zero', Boolean(refTamanho), refTamanho ?? 'sem ref');
  checa('acha o card com radio display:none (label for=)', Boolean(refDisplay), refDisplay ?? 'sem ref');
  checa('o card reporta papel "radio", não "texto"', /radio "[^"]*abstração/.test(cards));
  checa('o card reporta o estado do controle escondido', /abstração[^\n]*\[desmarcado/.test(cards));

  if (refTamanho) {
    await nav.marcar(refTamanho, true);
    const depois = await nav.instantaneo();
    // Esta asserção prova o que importa: o estado vem de `.checked` do input
    // escondido, não da aparência do card. Se o clique só tivesse mexido no
    // visual, aqui continuaria [desmarcado].
    checa('marcar() no card marca o input de verdade', /abstração[^\n]*\[marcado/.test(depois));
    checa('a alternativa irmã continua desmarcada', /renderizar[^\n]*\[desmarcado/.test(depois));
  }

  // O token escondido não pode virar alternativa fantasma.
  checa('NÃO inventa ref para o token escondido sem fachada', !/csrf/i.test(cards));

  // --- Inalcançáveis não podem virar alvo de clique ---
  console.log('\nElementos inalcançáveis:');
  checa('OMITE link jogado para fora do documento', !cards.includes('Fechar painel lateral'));
  checa('OMITE link recortado por overflow:hidden', !cards.includes('Botao do painel deslizante'));
  checa('OMITE elemento fixed fora da janela', !cards.includes('Menu fixo escondido'));
  // O contrapeso: filtrar demais seria pior que filtrar de menos. Conteúdo
  // abaixo da dobra é alcançável (basta rolar) e tem que continuar entrando.
  checa('MANTÉM link normal alcançável', cards.includes('Link la embaixo mas alcancavel'));

  // --- A senha não pode vazar ---
  console.log('\nVazamento de senha no instantâneo:');
  await nav.navegar('/login');
  const snapLogin = await nav.instantaneo();
  const refSenha = /senha "[^"]*"[^\n]*ref=(e\d+)/.exec(snapLogin)?.[1];
  checa('o campo de senha aparece como tipo "senha"', Boolean(refSenha), snapLogin.includes('senha') ? '' : 'não achou');
  if (refSenha) {
    await nav.preencher(refSenha, 'MinhaSenha123!');
    const comSenha = await nav.instantaneo();
    checa('NÃO mostra a senha digitada', !comSenha.includes('MinhaSenha123'));
    checa('mostra só "preenchido"', comSenha.includes('preenchido'));
  }

  console.log(`\n${falhas === 0 ? '✅ tudo passou' : `❌ ${falhas} falha(s)`}`);
} catch (err) {
  console.error('\n💥 erro:', err);
  falhas += 1;
} finally {
  await nav.fechar();
  await fs.writeFile(PATHS.config, backup); // devolve a config do dono
  servidor.close();
  process.exit(falhas === 0 ? 0 : 1);
}
