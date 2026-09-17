/**
 * O saneamento das perguntas é a régua entre o que o modelo manda e o que a
 * tela mostra. Formulário pela metade é pior que nenhum: a pessoa responde uma
 * coisa achando que respondeu outra.
 */
import { sanear } from '../server/perguntas';

let falhas = 0;
const checa = (nome: string, ok: boolean, extra = '') => {
  console.log(`${ok ? '  ok  ' : '  FALHA'} ${nome}${extra ? ` — ${extra}` : ''}`);
  if (!ok) falhas += 1;
};

console.log('Saneamento:');
const ok = sanear({
  questions: [
    {
      question: 'Qual caminho para o bloqueio de tela?',
      header: 'Energia',
      options: [
        { label: 'Desligar o protetor', description: 'Some o bloqueio, perde a proteção ao sair.' },
        { label: 'Só aumentar o tempo', description: 'Mantém a proteção, atrasa o bloqueio.' },
      ],
    },
  ],
});
checa('pergunta completa passa', ok.length === 1 && ok[0].opcoes.length === 2);
checa('etiqueta preservada', ok[0].etiqueta === 'Energia');
checa('descrição preservada', ok[0].opcoes[0].descricao?.startsWith('Some') === true);

checa('sem enunciado é descartada', sanear({ questions: [{ question: '   ', options: [] }] }).length === 0);
checa('input torto vira lista vazia', sanear({} as never).length === 0);
checa('questions não-array vira vazio', sanear({ questions: 'oi' } as never).length === 0);

const cortada = sanear({ questions: Array.from({ length: 7 }, (_, i) => ({ question: `p${i}`, options: [] })) });
checa('corta em 4 perguntas (não recusa)', cortada.length === 4, `${cortada.length}`);

const muitas = sanear({
  questions: [{ question: 'q', options: Array.from({ length: 9 }, (_, i) => ({ label: `o${i}` })) }],
});
checa('corta em 6 opções', muitas[0].opcoes.length === 6, `${muitas[0].opcoes.length}`);

const repetida = sanear({
  questions: [{ question: 'q', options: [{ label: 'A' }, { label: 'A' }, { label: 'B' }] }],
});
checa('rótulo repetido some (é a identidade da escolha)', repetida[0].opcoes.length === 2);

const semRotulo = sanear({ questions: [{ question: 'q', options: [{ label: '' }, { label: 'B' }, { label: 'C' }] }] });
checa('opção sem rótulo é descartada', semRotulo[0].opcoes.length === 2);

// Uma opção só não é escolha: vira pergunta aberta, com campo de texto.
const umaSo = sanear({ questions: [{ question: 'q', options: [{ label: 'única' }] }] });
checa('uma opção só vira pergunta aberta', umaSo[0].opcoes.length === 0);

const aberta = sanear({ questions: [{ question: 'Qual o CEP?' }] });
checa('sem options é pergunta aberta', aberta.length === 1 && aberta[0].opcoes.length === 0);

const varias = sanear({
  questions: [{ question: 'q', multiSelect: true, options: [{ label: 'A' }, { label: 'B' }] }],
});
checa('multiSelect vira varias', varias[0].varias === true);

const variasSemOpcoes = sanear({ questions: [{ question: 'q', multiSelect: true }] });
checa('multiSelect sem opções não marca varias', variasSemOpcoes[0].varias === undefined);

const longa = sanear({
  questions: [{ question: 'x'.repeat(900), header: 'y'.repeat(80), options: [{ label: 'z'.repeat(400) }, { label: 'w' }] }],
});
checa('enunciado é cortado em 400', longa[0].pergunta.length === 400);
checa('etiqueta é cortada em 24', (longa[0].etiqueta ?? '').length === 24);
checa('rótulo é cortado em 120', longa[0].opcoes[0].rotulo.length === 120);

const espacos = sanear({ questions: [{ question: '  linha um\n\n  linha dois  ', options: [] }] });
checa('espaço em branco é achatado', espacos[0].pergunta === 'linha um linha dois', espacos[0].pergunta);

console.log(`\n${falhas === 0 ? '✅ tudo passou' : `❌ ${falhas} falha(s)`}`);
process.exit(falhas === 0 ? 0 : 1);
