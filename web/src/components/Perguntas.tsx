import { useState } from 'react';
import type { Sessao } from '@shared/types';
import { Badge } from './ui';
import { responderPergunta } from '../api';

/**
 * O formulário de perguntas do agente.
 *
 * Existe pelo mesmo motivo que levou o HIVE a construir o dele: quando o agente
 * pergunta em TEXTO, a tela tenta adivinhar o formato e erra — três perguntas
 * viram "escolha uma", uma lista para marcar vira escolha única. Com schema, o
 * que aparece é o que ele quis dizer.
 *
 * Enquanto este painel está aberto, a ferramenta do agente está literalmente
 * parada esperando o clique — igual ao cartão de aprovação.
 */
export function Perguntas({ sessao }: { sessao: Sessao }) {
  const p = sessao.pergunta;
  // Uma resposta por pergunta: texto para aberta, rótulo(s) para escolha.
  const [respostas, setRespostas] = useState<string[]>(() => (p ? p.itens.map(() => '') : []));
  const [marcadas, setMarcadas] = useState<string[][]>(() => (p ? p.itens.map(() => []) : []));
  const [enviando, setEnviando] = useState(false);
  if (!p) return null;

  const definir = (i: number, v: string) =>
    setRespostas((r) => r.map((x, k) => (k === i ? v : x)));

  const alternarMarcada = (i: number, rotulo: string, varias: boolean) => {
    setMarcadas((m) =>
      m.map((lista, k) => {
        if (k !== i) return lista;
        if (!varias) return [rotulo];
        return lista.includes(rotulo) ? lista.filter((x) => x !== rotulo) : [...lista, rotulo];
      }),
    );
  };

  // Escolhas viram texto; "Outro" preenchido entra junto — a pessoa pode marcar
  // uma opção E explicar, e jogar fora a explicação seria perder o que importa.
  const respostaDe = (i: number): string =>
    [marcadas[i].join(' + '), respostas[i].trim()].filter(Boolean).join(' — ');

  const faltando = p.itens.some((_, i) => !respostaDe(i));

  const enviar = async () => {
    setEnviando(true);
    try {
      await responderPergunta(sessao.id, p.id, p.itens.map((_, i) => respostaDe(i)));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="animate-fade-in rounded-2xl border border-accent-violet/40 bg-accent-violet/[0.07] p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">💬</span>
        <h3 className="text-sm font-semibold text-accent-violet">
          {p.itens.length === 1 ? 'Ele tem uma pergunta' : `Ele tem ${p.itens.length} perguntas`}
        </h3>
      </div>

      {p.contexto && (
        <p className="mb-4 whitespace-pre-wrap text-xs leading-relaxed text-white/50">{p.contexto}</p>
      )}

      <div className="flex flex-col gap-5">
        {p.itens.map((item, i) => (
          <div key={i}>
            <div className="mb-2 flex items-center gap-2">
              {item.etiqueta && <Badge color="#8b7bff">{item.etiqueta}</Badge>}
              {item.varias && <span className="text-[10px] uppercase text-white/30">marque quantas quiser</span>}
            </div>
            <p className="mb-2 text-sm text-white/85">{item.pergunta}</p>

            {item.opcoes.length > 0 && (
              <div className="mb-2 flex flex-col gap-1.5">
                {item.opcoes.map((op) => {
                  const marcada = marcadas[i].includes(op.rotulo);
                  return (
                    <button
                      key={op.rotulo}
                      type="button"
                      onClick={() => alternarMarcada(i, op.rotulo, Boolean(item.varias))}
                      className={`rounded-xl border p-3 text-left transition ${
                        marcada
                          ? 'border-accent-violet/60 bg-accent-violet/15'
                          : 'border-white/10 bg-black/20 hover:bg-black/30'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 text-xs ${marcada ? 'text-accent-violet' : 'text-white/25'}`}>
                          {item.varias ? (marcada ? '☑' : '☐') : marcada ? '◉' : '○'}
                        </span>
                        <span>
                          <span className="block text-sm font-medium text-white/85">{op.rotulo}</span>
                          {op.descricao && (
                            <span className="mt-0.5 block text-xs leading-relaxed text-white/45">{op.descricao}</span>
                          )}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <input
              value={respostas[i]}
              onChange={(e) => definir(i, e.target.value)}
              placeholder={item.opcoes.length ? 'Outro / observação (opcional)' : 'Sua resposta'}
              className="glass-input w-full"
            />
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          className="btn-primary"
          disabled={enviando || faltando}
          onClick={() => void enviar()}
          title={faltando ? 'Responda todas as perguntas' : undefined}
        >
          {enviando ? 'Enviando…' : 'Responder'}
        </button>
        <span className="text-[11px] text-white/35">Ele está parado esperando.</span>
      </div>
    </div>
  );
}
