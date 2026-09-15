/**
 * A função que roda DENTRO da página e produz o "instantâneo" que a LLM lê.
 *
 * Por que árvore de acessibilidade e não screenshot: o modelo não precisa
 * enxergar para clicar. Ele precisa saber que existe um radio chamado
 * "Brasília" e como endereçá-lo. Texto estruturado custa uma fração dos tokens
 * de uma imagem, não depende de coordenada (que quebra a cada rolagem) e é
 * determinístico. Screenshot vira o que deve ser: o recurso para quando a
 * questão está numa figura.
 *
 * Cada elemento acionável ganha um `data-diploma-ref`, e é por esse atributo
 * que as ações endereçam depois. Os refs são reatribuídos a cada instantâneo:
 * ref de página antiga não resolve, o que é melhor do que clicar no lugar errado.
 */
export const ATRIBUTO_REF = 'data-diploma-ref';

export interface ResultadoInstantaneo {
  linhas: string;
  totalElementos: number;
  truncado: boolean;
}

/**
 * Monta o texto que é avaliado dentro da página.
 *
 * Por que texto, e não passar a função direto para `evaluate`: o tsx/esbuild
 * transpila este arquivo com `keepNames`, que embrulha cada função declarada
 * numa chamada `__name(...)`. Esse helper existe no Node e NÃO existe na
 * página — a função serializada morre com "__name is not defined", e como o
 * erro acontece do outro lado ele é fácil de confundir com página quebrada.
 *
 * O shim resolve. A checagem embaixo é o que importa de verdade: se um dia o
 * transpilador injetar um helper novo, isso falha alto aqui em vez de virar um
 * instantâneo vazio que faria o agente trabalhar às cegas.
 */
export function fonteInstantaneo(atributo: string, maxLinhas: number): string {
  const corpo = coletarInstantaneo.toString();
  const injetados = [...new Set(corpo.match(/\b__[a-zA-Z]\w*/g) ?? [])];
  const desconhecidos = injetados.filter((h) => h !== '__name');
  if (desconhecidos.length) {
    throw new Error(
      `o transpilador injetou helpers que não existem no browser: ${desconhecidos.join(', ')}. ` +
        'Acrescente um shim em fonteInstantaneo() antes de seguir.',
    );
  }
  const args = JSON.stringify([atributo, maxLinhas]);
  return `(() => { const __name = (f) => f; return (${corpo})(${args}); })()`;
}

/**
 * Serializada e executada no browser.
 *
 * Duas restrições que não se leem no corpo, e que quebram tudo em silêncio se
 * violadas: ela **não pode referenciar nada do escopo do módulo** (só existe o
 * texto da própria função do outro lado), e recebe **um único argumento** — é
 * assim que `frame.evaluate(fn, arg)` passa dados para dentro da página.
 */
export function coletarInstantaneo(
  [atributo, maxLinhas]: [string, number],
): ResultadoInstantaneo {
  const INTERATIVOS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'SUMMARY']);
  const PAPEIS_INTERATIVOS = new Set([
    'button', 'link', 'checkbox', 'radio', 'tab', 'menuitem', 'option',
    'switch', 'textbox', 'combobox', 'slider', 'treeitem',
  ]);
  const BLOCOS_TEXTO = new Set([
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'TD', 'TH', 'LEGEND',
    'DT', 'DD', 'FIGCAPTION', 'BLOCKQUOTE', 'CAPTION', 'LABEL', 'SPAN', 'DIV',
  ]);
  const IGNORAR = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'HEAD', 'META', 'LINK', 'TEMPLATE']);
  // Containers que carregam input escondido por outros motivos (token CSRF,
  // campo de estado): nunca são a fachada clicável de uma alternativa.
  const NAO_SAO_FACHADA = new Set(['FORM', 'FIELDSET', 'BODY', 'MAIN', 'SECTION', 'ARTICLE', 'NAV', 'TABLE', 'UL', 'OL']);

  // Limpa refs do instantâneo anterior: nada de ref fantasma sobrevivendo.
  document.querySelectorAll('[' + atributo + ']').forEach(function (el) {
    el.removeAttribute(atributo);
  });

  function limpar(s: string | null | undefined): string {
    return (s || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  }

  function visivel(el: Element): boolean {
    const he = el as HTMLElement;
    const estilo = window.getComputedStyle(he);
    if (estilo.display === 'none' || estilo.visibility === 'hidden') return false;
    if (estilo.opacity === '0') return false;
    const r = he.getBoundingClientRect();
    // Campo type=hidden não tem caixa. Se o humano não pode preencher, o agente
    // também não deve — então some do instantâneo junto com o resto do invisível.
    return r.width > 0 || r.height > 0;
  }

  /**
   * Visível não é o mesmo que alcançável.
   *
   * Um painel deslizante fechado, um menu fora da tela, um modal que o tema
   * guarda em `left:-9999px` — tudo isso passa em `visivel()` (tem caixa, não
   * tem display:none) e mesmo assim é impossível clicar: o Playwright rola,
   * não chega, e fica 20 segundos tentando até estourar. Foi assim que um "X
   * de fechar" de um painel de anotações queimou um turno inteiro.
   *
   * Aqui derrubamos só os casos sem ambiguidade. Conteúdo abaixo da dobra é
   * alcançável (basta rolar) e continua entrando.
   */
  function alcancavel(el: Element): boolean {
    const r = el.getBoundingClientRect();
    const doc = document.documentElement;

    // Jogado para fora do documento (o velho truque do left:-9999px).
    if (r.right + window.scrollX < 0) return false;
    if (r.bottom + window.scrollY < 0) return false;
    if (r.left + window.scrollX > doc.scrollWidth) return false;

    // `fixed` fora da janela: rolar a página não move o elemento junto.
    const meu = window.getComputedStyle(el);
    if (meu.position === 'fixed') {
      if (r.right <= 0 || r.bottom <= 0) return false;
      if (r.left >= window.innerWidth || r.top >= window.innerHeight) return false;
    }

    // Recortado inteiro por um ancestral com `overflow:hidden` — o painel
    // fechado. Só `hidden`: `auto`/`scroll` o usuário consegue rolar.
    let pai = el.parentElement;
    for (let n = 0; pai && n < 12; n += 1, pai = pai.parentElement) {
      const est = window.getComputedStyle(pai);
      const cortaX = est.overflowX === 'hidden';
      const cortaY = est.overflowY === 'hidden';
      if (!cortaX && !cortaY) continue;

      const pr = pai.getBoundingClientRect();
      if (pr.width <= 0 || pr.height <= 0) continue;
      if (cortaX && (r.right <= pr.left || r.left >= pr.right)) return false;
      if (cortaY && (r.bottom <= pr.top || r.top >= pr.bottom)) return false;
    }

    return true;
  }

  /**
   * O padrão "alternativa como card": o <input type=radio> de verdade é
   * escondido (opacity:0, tamanho zero, display:none) e quem responde ao clique
   * é o <label>/card estilizado por cima. É como quase todo LMS moderno desenha
   * quiz — e, lido ao pé da letra, `visivel()` jogava o controle fora e não
   * sobrava ref nenhum para marcar a alternativa.
   *
   * Então: quando um elemento VISÍVEL é a fachada de um controle ESCONDIDO, o
   * ref pousa na fachada (que é o que responde ao clique) e a semântica vem do
   * controle (que é quem sabe se está marcado). É o que um humano faz: ele
   * clica no card, não no input.
   *
   * Devolve o controle escondido, ou null quando não é esse caso.
   */
  function controleAtrasDaFachada(el: Element): HTMLInputElement | null {
    if (!visivel(el)) return null;

    // Containers grandes carregam inputs escondidos por outros motivos
    // (CSRF token, campo de estado). Fachada é peça pequena e específica.
    if (NAO_SAO_FACHADA.has(el.tagName)) return null;

    const rotulo = el.tagName === 'LABEL' ? (el as HTMLLabelElement) : null;
    let ctrl: Element | null = null;

    // <label for="x"> com o input em outro lugar do DOM.
    if (rotulo && rotulo.htmlFor) ctrl = document.getElementById(rotulo.htmlFor);
    // <label><input …> texto</label>, ou card que embrulha o input.
    if (!ctrl) ctrl = el.querySelector('input');

    if (!ctrl || ctrl.tagName !== 'INPUT') return null;
    const inp = ctrl as HTMLInputElement;

    // Só interessa o que é marcável: radio e checkbox. Um campo de texto
    // escondido atrás de um card não é uma alternativa de questão.
    const t = (inp.type || '').toLowerCase();
    if (t !== 'radio' && t !== 'checkbox') return null;

    // Se o controle já aparece sozinho, o caminho normal dá conta.
    if (visivel(inp)) return null;

    // Fachada tem que ser clicável de fato: um <label> sempre é (o clique
    // propaga para o controle); qualquer outra coisa precisa se declarar.
    const ehLabel = el.tagName === 'LABEL';
    const papel = (el.getAttribute('role') || '').toLowerCase();
    const declarado = papel === 'radio' || papel === 'checkbox' || papel === 'option' || papel === 'button';
    if (!ehLabel && !declarado && !el.hasAttribute('onclick')) return null;

    return inp;
  }

  /** Nome acessível, na ordem de precedência que os leitores de tela usam. */
  function nomeDe(el: Element): string {
    const he = el as HTMLElement;
    const aria = limpar(he.getAttribute('aria-label'));
    if (aria) return aria;

    const rotuladoPor = he.getAttribute('aria-labelledby');
    if (rotuladoPor) {
      const partes: string[] = [];
      rotuladoPor.split(/\s+/).forEach(function (id) {
        const alvo = document.getElementById(id);
        const t = limpar(alvo ? alvo.textContent : '');
        if (t) partes.push(t);
      });
      if (partes.length) return limpar(partes.join(' '));
    }

    if (he.id) {
      const lbl = document.querySelector('label[for=' + JSON.stringify(he.id) + ']');
      const t = limpar(lbl ? lbl.textContent : '');
      if (t) return t;
    }
    const paiLabel = he.closest('label');
    if (paiLabel) {
      const t = limpar(paiLabel.textContent);
      if (t) return t;
    }

    const alt = limpar(he.getAttribute('alt'));
    if (alt) return alt;
    const ph = limpar(he.getAttribute('placeholder'));
    if (ph) return ph;
    const titulo = limpar(he.getAttribute('title'));
    if (titulo) return titulo;

    return limpar(he.textContent);
  }

  function ehInterativo(el: Element): boolean {
    const he = el as HTMLElement;
    if (INTERATIVOS.has(he.tagName)) {
      if (he.tagName === 'INPUT' && (he as HTMLInputElement).type === 'hidden') return false;
      return true;
    }
    const papel = (he.getAttribute('role') || '').toLowerCase();
    if (PAPEIS_INTERATIVOS.has(papel)) return true;
    if (he.hasAttribute('onclick')) return true;
    if (he.isContentEditable) return true;
    const ti = he.getAttribute('tabindex');
    if (ti !== null && Number(ti) >= 0) return true;
    return false;
  }

  /** Traduz para um papel legível — o que o modelo vê como "tipo". */
  function papelDe(el: Element): string {
    const he = el as HTMLElement;
    const explicito = (he.getAttribute('role') || '').toLowerCase();
    if (explicito) return explicito;
    switch (he.tagName) {
      case 'A': return he.hasAttribute('href') ? 'link' : 'texto';
      case 'BUTTON': return 'botao';
      case 'SELECT': return 'lista';
      case 'TEXTAREA': return 'area-texto';
      case 'SUMMARY': return 'expansor';
      case 'INPUT': {
        const t = ((he as HTMLInputElement).type || 'text').toLowerCase();
        if (t === 'checkbox') return 'caixa';
        if (t === 'radio') return 'radio';
        if (t === 'submit' || t === 'button') return 'botao';
        if (t === 'file') return 'arquivo';
        if (t === 'password') return 'senha';
        return 'campo';
      }
      case 'H1': case 'H2': case 'H3':
      case 'H4': case 'H5': case 'H6':
        return 'titulo';
      case 'LI': return 'item';
      case 'TD': case 'TH': return 'celula';
      case 'IMG': return 'imagem';
      default: return 'texto';
    }
  }

  /** Estado que muda a decisão do agente (marcado, desabilitado, valor). */
  function estadoDe(el: Element): string {
    const he = el as HTMLElement;
    const partes: string[] = [];
    const inp = he as HTMLInputElement;

    if (he.tagName === 'INPUT' && (inp.type === 'checkbox' || inp.type === 'radio')) {
      partes.push(inp.checked ? 'marcado' : 'desmarcado');
    }
    const ariaChecked = he.getAttribute('aria-checked');
    if (ariaChecked) partes.push(ariaChecked === 'true' ? 'marcado' : 'desmarcado');

    if ((he as HTMLButtonElement).disabled || he.getAttribute('aria-disabled') === 'true') {
      partes.push('desabilitado');
    }
    const expandido = he.getAttribute('aria-expanded');
    if (expandido) partes.push(expandido === 'true' ? 'aberto' : 'fechado');
    if (he.getAttribute('aria-selected') === 'true') partes.push('selecionado');
    if (inp.required) partes.push('obrigatorio');

    const ehCampo =
      he.tagName === 'TEXTAREA' ||
      (he.tagName === 'INPUT' && inp.type !== 'checkbox' && inp.type !== 'radio');
    if (ehCampo) {
      const v = limpar(inp.value);
      // Campo de senha: dizemos se está preenchido, NUNCA o conteúdo — senão a
      // senha do cofre vazaria para o contexto da LLM pelo próprio instantâneo.
      if (inp.type === 'password') partes.push(v ? 'preenchido' : 'vazio');
      else if (v) partes.push('valor=' + JSON.stringify(v.slice(0, 80)));
    }
    const nivel = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 }[he.tagName];
    if (nivel) partes.push('nivel=' + nivel);

    return partes.length ? ' [' + partes.join(', ') + ']' : '';
  }

  const linhas: string[] = [];
  let contador = 0;
  let truncado = false;

  function visitar(el: Element, profundidade: number): void {
    if (truncado) return;
    if (IGNORAR.has(el.tagName)) return;
    if (!visivel(el)) return;

    // Quando o elemento é a fachada de um controle escondido, ele passa a ser
    // o alvo do clique e o controle empresta o papel e o estado.
    const oculto = controleAtrasDaFachada(el);
    const semantica = oculto ?? el;

    const interativo = Boolean(oculto) || ehInterativo(el);
    const imagem = el.tagName === 'IMG';
    const blocoTexto = BLOCOS_TEXTO.has(el.tagName);

    // Texto só conta se for FILHO DIRETO deste nó. Sem isso a saída vira o
    // documento inteiro repetido uma vez por nível de aninhamento.
    let textoProprio = false;
    if (blocoTexto) {
      const filhos = Array.prototype.slice.call(el.childNodes) as ChildNode[];
      textoProprio = filhos.some(function (n) {
        return n.nodeType === 3 && (n.textContent || '').trim().length > 0;
      });
    }

    let emitiu = false;

    if (interativo || imagem || (blocoTexto && textoProprio)) {
      const nome = nomeDe(el);
      // Um elemento inalcançável só vale a linha se for texto: como alvo de
      // clique ele é uma armadilha, e dar ref a ele é convidar o agente a
      // gastar o turno numa ação que nunca completa.
      if (interativo && !alcancavel(el)) return;
      if (nome) {
        if (linhas.length >= maxLinhas) {
          truncado = true;
          return;
        }
        const recuo = new Array(Math.min(profundidade, 8) + 1).join('  ');
        let ref = '';
        if (interativo) {
          contador += 1;
          ref = ' ref=e' + contador;
          el.setAttribute(atributo, 'e' + contador);
        }
        let extra = '';
        if (el.tagName === 'A') {
          const href = (el.getAttribute('href') || '').slice(0, 120);
          if (href) extra = ' href=' + href;
        }
        linhas.push(
          recuo + '- ' + papelDe(semantica) + ' ' + JSON.stringify(nome) + ref +
          estadoDe(semantica) + extra,
        );
        emitiu = true;
      }
    }

    // <select>: as opções são exatamente o que o agente precisa ver para escolher.
    if (el.tagName === 'SELECT') {
      const sel = el as HTMLSelectElement;
      const opts = Array.prototype.slice.call(sel.options, 0, 40) as HTMLOptionElement[];
      for (const opt of opts) {
        if (linhas.length >= maxLinhas) {
          truncado = true;
          return;
        }
        const marca = opt.selected ? ' [selecionado]' : '';
        const recuo = new Array(Math.min(profundidade + 1, 9) + 1).join('  ');
        linhas.push(
          recuo + '- opcao ' + JSON.stringify(limpar(opt.textContent)) +
          ' valor=' + JSON.stringify(opt.value) + marca,
        );
      }
      return; // não descemos mais: as <option> já saíram
    }

    const filhos = Array.prototype.slice.call(el.children) as Element[];
    for (const filho of filhos) {
      visitar(filho, emitiu ? profundidade + 1 : profundidade);
    }
  }

  if (document.body) visitar(document.body, 0);

  return { linhas: linhas.join('\n'), totalElementos: contador, truncado };
}
