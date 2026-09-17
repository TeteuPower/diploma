import { useEffect, useState } from 'react';
import type { DiplomaConfig, ModoAutonomia, AcaoSensivel, Perfil } from '@shared/types';
import { ACOES_SENSIVEIS } from '@shared/types';
import { Panel, Field, TextInput, TextArea, Select, Toggle, OptionCard } from '../components/ui';
import {
  ROTULO_MODO, DESCRICAO_MODO, CORES_MODO, ICONE_MODO, ROTULO_ACAO, HINT_ACAO,
} from '../lib/modo';
import {
  patchConfig, fecharNavegador, getBrave, salvarChaveBrave, removerChaveBrave, testarBrave,
  getAtualizacao, verificarAtualizacao, instalarAtualizacao,
  getInstalacaoChromium, instalarChromium,
  type EstadoAtualizacao, type InstalacaoChromium,
} from '../api';
import { dataHora } from '../lib/modo';

const MODOS: ModoAutonomia[] = ['observar', 'assistido', 'guiado', 'autonomo'];

export function Config({
  config,
  onMudou,
}: {
  config: DiplomaConfig | null;
  onMudou: () => void;
}) {
  // Estado local para os campos de texto: salvar a cada tecla brigaria com o
  // PATCH e faria o cursor pular. Toggles e seleções salvam na hora.
  const [nome, setNome] = useState('');
  const [urlBase, setUrlBase] = useState('');
  const [caminhoLogin, setCaminhoLogin] = useState('');
  const [instrucoes, setInstrucoes] = useState('');
  const [perfil, setPerfil] = useState<Perfil>({
    nome: '', cep: '', endereco: '', cidade: '', uf: '', telefone: '', email: '',
  });
  const [listaGlobal, setListaGlobal] = useState('');
  const [brave, setBrave] = useState<{ configurada: boolean; pais: string } | null>(null);
  const [braveChave, setBraveChave] = useState('');
  const [braveTeste, setBraveTeste] = useState<string | null>(null);
  const [repositorio, setRepositorio] = useState('');
  const [atualizacao, setAtualizacao] = useState<EstadoAtualizacao | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [instalacaoChromium, setInstalacaoChromium] = useState<InstalacaoChromium | null>(null);

  // Atualização e Chromium mudam por conta própria (download em andamento):
  // enquanto algo está rodando, a tela acompanha a cada 2 s.
  useEffect(() => {
    let vivo = true;
    const ler = async () => {
      try {
        const [a, c] = await Promise.all([getAtualizacao(), getInstalacaoChromium()]);
        if (!vivo) return;
        setAtualizacao(a);
        setInstalacaoChromium(c);
      } catch {
        /* servidor reiniciando durante um update: silêncio */
      }
    };
    void ler();
    const t = setInterval(() => {
      if (atualizacao?.andamento || instalacaoChromium?.rodando) void ler();
    }, 2000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [atualizacao?.andamento, instalacaoChromium?.rodando]);

  useEffect(() => {
    void getBrave().then(setBrave).catch(() => {});
  }, [config]);
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!config || sujo) return;
    setNome(config.alvo.nome);
    setUrlBase(config.alvo.urlBase);
    setCaminhoLogin(config.alvo.caminhoLogin);
    setInstrucoes(config.instrucoes);
    setPerfil(config.perfil);
    setListaGlobal(config.web.listaGlobal.join('\n'));
    setRepositorio(config.atualizacao.repositorio);
  }, [config, sujo]);

  if (!config) return null;

  const salvar = async (patch: Partial<DiplomaConfig>) => {
    setSalvando(true);
    try {
      await patchConfig(patch);
      onMudou();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setSalvando(false);
    }
  };

  const salvarTextos = async () => {
    await salvar({
      alvo: { nome, urlBase, caminhoLogin },
      instrucoes,
      perfil,
      web: { ...config.web, listaGlobal: listaGlobal.split(/[\s,]+/).filter(Boolean) },
      atualizacao: { ...config.atualizacao, repositorio: repositorio.trim() },
    });
    setSujo(false);
  };

  const alternarAcao = (acao: AcaoSensivel) => {
    const atual = config.exigemAprovacao;
    const proximo = atual.includes(acao) ? atual.filter((a) => a !== acao) : [...atual, acao];
    void salvar({ exigemAprovacao: proximo });
  };

  // O mesmo botão "Salvar" dos painéis de texto, para os painéis novos.
  const botaoSalvar = sujo && (
    <button
      type="button"
      className="btn-primary px-3 py-1 text-xs"
      disabled={salvando}
      onClick={() => void salvarTextos()}
    >
      {salvando ? 'Salvando…' : 'Salvar'}
    </button>
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Panel
        title="O domínio apontado"
        icon="🎯"
        accent="#38e0d8"
        right={
          sujo && (
            <button
              type="button"
              className="btn-primary px-3 py-1 text-xs"
              disabled={salvando}
              onClick={() => void salvarTextos()}
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          )
        }
      >
        <p className="mb-4 text-xs leading-relaxed text-white/45">
          Este endereço é a fronteira do agente:{' '}
          <strong className="text-white/70">ele não navega para fora daqui</strong>. A trava é
          código, não instrução de prompt — vale contra o modelo se perder e contra link plantado
          numa página do curso.
        </p>

        <Field label="Nome da plataforma" hint="Só para você reconhecer na interface.">
          <TextInput
            value={nome}
            onChange={(e) => {
              setNome(e.target.value);
              setSujo(true);
            }}
            placeholder="AVA da faculdade"
          />
        </Field>

        <Field label="Endereço base" hint="Ex.: https://ava.faculdade.edu.br — subdomínios entram junto.">
          <TextInput
            value={urlBase}
            onChange={(e) => {
              setUrlBase(e.target.value);
              setSujo(true);
            }}
            placeholder="https://ava.faculdade.edu.br"
          />
        </Field>

        <Field label="Caminho do login" hint="A rota da tela de entrada, se não for a raiz.">
          <TextInput
            value={caminhoLogin}
            onChange={(e) => {
              setCaminhoLogin(e.target.value);
              setSujo(true);
            }}
            placeholder="/login"
          />
        </Field>
      </Panel>

      <Panel title="Quanta corda o agente tem" icon="🎚️" accent={CORES_MODO[config.modo]}>
        <div className="grid grid-cols-2 gap-2.5">
          {MODOS.map((m) => (
            <OptionCard
              key={m}
              selecionado={config.modo === m}
              onClick={() => void salvar({ modo: m })}
              titulo={ROTULO_MODO[m]}
              descricao={DESCRICAO_MODO[m]}
              icone={ICONE_MODO[m]}
              cor={CORES_MODO[m]}
            />
          ))}
        </div>

        {config.modo === 'guiado' && (
          <div className="mt-4 animate-fade-in">
            <div className="label">O que ainda para para você aprovar</div>
            <div className="flex flex-col gap-2">
              {ACOES_SENSIVEIS.map((a) => (
                <Toggle
                  key={a}
                  checked={config.exigemAprovacao.includes(a)}
                  onChange={() => alternarAcao(a)}
                  label={ROTULO_ACAO[a]}
                  hint={HINT_ACAO[a]}
                />
              ))}
            </div>
          </div>
        )}

        <div className="mt-4">
          <Field
            label="Tentativas que ele pode abrir por quiz"
            hint="Padrão 1. Continuar numa tentativa já aberta não conta — o limite é de ABRIR outra. Assim sobra tentativa para você conferir o resultado e refazer se quiser."
          >
            <TextInput
              type="number"
              min={1}
              max={10}
              value={config.tentativasPorQuiz}
              onChange={(e) => void salvar({ tentativasPorQuiz: Number(e.target.value) })}
            />
          </Field>
        </div>

        {config.modo === 'autonomo' && (
          <p className="mt-4 rounded-xl border border-accent-rose/30 bg-accent-rose/[0.07] p-3 text-xs leading-relaxed text-accent-rose/90">
            Sem rede de segurança: uma questão lida errado vira uma resposta enviada, e submissão
            de quiz normalmente não volta atrás. Vale deixar o agente acertar algumas vezes no modo
            assistido antes de soltar aqui.
          </p>
        )}
      </Panel>

      <Panel title="Navegador" icon="🌐" accent="#8b7bff">
        <div className="mb-4 flex flex-col gap-2">
          <Toggle
            checked={!config.navegador.headless}
            onChange={(v) => void salvar({ navegador: { ...config.navegador, headless: !v } })}
            label="Mostrar a janela do navegador"
            hint="Com a janela aberta você acompanha e resolve captcha/2FA na mão quando ele travar."
          />
          <Toggle
            checked={config.navegador.perfilPersistente}
            onChange={(v) =>
              void salvar({ navegador: { ...config.navegador, perfilPersistente: v } })
            }
            label="Manter a sessão entre execuções"
            hint="Guarda os cookies do LMS em perfil-navegador/. Loga uma vez e nas próximas já entra."
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label="Teto de passos" hint="Trava contra loop.">
            <TextInput
              type="number"
              min={5}
              max={500}
              value={config.navegador.maxPassos}
              onChange={(e) =>
                void salvar({
                  navegador: { ...config.navegador, maxPassos: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field label="Timeout de ação (ms)" hint="Espera por elemento.">
            <TextInput
              type="number"
              min={3000}
              max={120000}
              step={1000}
              value={config.navegador.timeoutMs}
              onChange={(e) =>
                void salvar({
                  navegador: { ...config.navegador, timeoutMs: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field label="Espera por você (s)" hint="Depois disso, a ação é recusada.">
            <TextInput
              type="number"
              min={30}
              max={7200}
              step={30}
              value={config.navegador.timeoutAprovacaoS}
              onChange={(e) =>
                void salvar({
                  navegador: { ...config.navegador, timeoutAprovacaoS: Number(e.target.value) },
                })
              }
            />
          </Field>
        </div>

        <button type="button" className="btn-ghost" onClick={() => void fecharNavegador()}>
          Fechar o navegador agora
        </button>
      </Panel>

      <Panel title="Onde ele pode navegar (missões web)" icon="🌐" accent="#8b7bff" right={botaoSalvar}>
        <p className="mb-4 text-xs leading-relaxed text-white/45">
          Missão LMS continua presa ao alvo lá em cima. Missão web usa a política escolhida na hora
          de criar a sessão — e, se você não escolher, esta aqui. Em qualquer política: nada de http
          em claro, e credencial do cofre só é digitada no site a que pertence.
        </p>
        <Field label="Política padrão">
          <Select
            value={config.web.politicaPadrao}
            onChange={(e) =>
              void salvar({ web: { ...config.web, politicaPadrao: e.target.value as 'aberto' | 'lista' } })
            }
          >
            <option value="aberto">Aberta — qualquer site https</option>
            <option value="lista">Lista — só os hosts abaixo</option>
          </Select>
        </Field>
        <Field
          label="Lista global de hosts"
          hint="Um por linha. Usada pela política 'lista' quando a missão não traz a sua."
        >
          <TextArea
            rows={4}
            value={listaGlobal}
            onChange={(e) => {
              setListaGlobal(e.target.value);
              setSujo(true);
            }}
            placeholder={'mercadolivre.com.br\nolx.com.br'}
          />
        </Field>
      </Panel>

      <Panel
        title="Atualizações"
        icon="⬆️"
        accent={atualizacao?.disponivel ? '#f5b955' : '#38e0d8'}
        right={
          <span className="font-mono text-[11px] text-white/40">
            v{atualizacao?.versaoAtual ?? '…'}
            {atualizacao && !atualizacao.instalado ? ' · código-fonte' : ''}
          </span>
        }
      >
        <p className="mb-4 text-xs leading-relaxed text-white/45">
          O app consulta as releases do GitHub e, se houver versão nova, baixa o instalador e roda
          em modo silencioso: ele fecha o Diploma, troca os arquivos e reabre. Seus dados (cofre,
          sessões, trabalhos) ficam em outra pasta e não são tocados.
          {atualizacao && !atualizacao.instalado && (
            <>
              {' '}
              <strong className="text-accent-amber/90">Rodando do código-fonte:</strong> verificar
              funciona, instalar não — atualize com <span className="font-mono">git pull</span>.
            </>
          )}
        </p>

        <div className="mb-4 flex flex-col gap-2">
          <Toggle
            checked={config.atualizacao.verificar}
            onChange={(v) => void salvar({ atualizacao: { ...config.atualizacao, verificar: v } })}
            label="Verificar automaticamente"
            hint="No início e a cada 6 horas. A API pública do GitHub permite 60 consultas por hora."
          />
          <Toggle
            checked={config.atualizacao.preReleases}
            onChange={(v) => void salvar({ atualizacao: { ...config.atualizacao, preReleases: v } })}
            label="Aceitar a build de cada push (pré-release &quot;latest&quot;)"
            hint="Recebe o último commit assim que ele passa no build. Sem isso, só releases numeradas."
          />
        </div>

        <Field label="Repositório" hint="dono/repositorio no GitHub. Vazio usa o padrão do projeto.">
          <TextInput
            value={repositorio}
            onChange={(e) => {
              setRepositorio(e.target.value);
              setSujo(true);
            }}
            placeholder="TeteuPower/diploma"
          />
        </Field>

        {atualizacao?.disponivel ? (
          <div className="mb-3 rounded-xl border border-accent-amber/30 bg-accent-amber/[0.07] p-4">
            <div className="mb-1 text-sm font-semibold text-accent-amber">
              Versão {atualizacao.disponivel.versao} disponível
              <span className="ml-2 font-mono text-[11px] font-normal text-white/40">
                {(atualizacao.disponivel.bytes / 1024 / 1024).toFixed(0)} MB
              </span>
            </div>
            {atualizacao.disponivel.notas && (
              <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap font-sans text-xs leading-relaxed text-white/60">
                {atualizacao.disponivel.notas}
              </pre>
            )}
            <a
              href={atualizacao.disponivel.urlPagina}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] text-accent/80 hover:underline"
            >
              ver no GitHub ↗
            </a>
          </div>
        ) : (
          atualizacao && (
            <p className="mb-3 text-xs text-white/40">
              Nenhuma versão mais nova
              {atualizacao.ultimaChecagem ? ` · conferido ${dataHora(atualizacao.ultimaChecagem)}` : ''}.
            </p>
          )
        )}

        {atualizacao?.andamento && (
          <div className="mb-3">
            <div className="mb-1 flex justify-between text-[11px] text-white/50">
              <span>{atualizacao.andamento.detalhe}</span>
              <span>{Math.round(atualizacao.andamento.progresso * 100)}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-accent-amber transition-all"
                style={{ width: `${Math.round(atualizacao.andamento.progresso * 100)}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost"
            disabled={verificando}
            onClick={async () => {
              setVerificando(true);
              try {
                setAtualizacao(await verificarAtualizacao());
              } catch (e) {
                alert(e instanceof Error ? e.message : String(e));
              } finally {
                setVerificando(false);
              }
            }}
          >
            {verificando ? 'Verificando…' : 'Verificar agora'}
          </button>
          {atualizacao?.disponivel && atualizacao.instalado && (
            <button
              type="button"
              className="btn-ok"
              disabled={Boolean(atualizacao.andamento && atualizacao.andamento.fase !== 'erro')}
              onClick={async () => {
                if (!confirm(`Baixar e instalar a versão ${atualizacao.disponivel?.versao}? O Diploma vai fechar e reabrir sozinho.`)) return;
                try {
                  const r = await instalarAtualizacao();
                  if (!r.ok) alert(r.motivo);
                } catch (e) {
                  alert(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Baixar e instalar
            </button>
          )}
          {instalacaoChromium && !instalacaoChromium.instalado && (
            <button
              type="button"
              className="btn-primary"
              disabled={instalacaoChromium.rodando}
              onClick={async () => {
                try {
                  await instalarChromium();
                  setInstalacaoChromium({ ...instalacaoChromium, rodando: true });
                } catch (e) {
                  alert(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              {instalacaoChromium.rodando ? 'Baixando o Chromium…' : 'Instalar o Chromium (~150 MB)'}
            </button>
          )}
        </div>
        {instalacaoChromium?.rodando && instalacaoChromium.saida.length > 0 && (
          <pre className="mt-3 max-h-28 overflow-auto rounded-lg bg-black/40 p-2 font-mono text-[10px] text-white/50">
            {instalacaoChromium.saida.slice(-6).join('\n')}
          </pre>
        )}
        {instalacaoChromium?.ok === false && (
          <p className="mt-2 text-xs text-accent-rose">A instalação do Chromium falhou — veja o log.</p>
        )}
      </Panel>

      <Panel title="Brave Search" icon="🦁" accent="#fb542b">
        <p className="mb-4 text-xs leading-relaxed text-white/45">
          Busca por API, sem abrir buscador no navegador — mais rápido e sem captcha. A chave vai
          para o <strong className="text-white/70">cofre</strong>, cifrada pelo Windows, e nunca
          entra no contexto da LLM: o agente só recebe título, link e descrição dos resultados.
        </p>
        <div className="grid grid-cols-[1fr_120px] gap-3">
          <Field
            label={brave?.configurada ? 'Chave da API (configurada — cole para substituir)' : 'Chave da API'}
            hint="Console da Brave Search API → Subscription token."
          >
            <TextInput
              type="password"
              autoComplete="off"
              value={braveChave}
              onChange={(e) => setBraveChave(e.target.value)}
              placeholder={brave?.configurada ? '••••••••••••' : 'BSA…'}
            />
          </Field>
          <Field label="País" hint="Opcional. Ex.: BR">
            <TextInput
              value={config.brave.pais}
              maxLength={2}
              onChange={(e) => void salvar({ brave: { pais: e.target.value.toUpperCase() } })}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            disabled={!braveChave.trim()}
            onClick={async () => {
              try {
                await salvarChaveBrave(braveChave.trim());
                setBraveChave('');
                setBraveTeste(null);
                setBrave(await getBrave());
              } catch (e) {
                alert(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            Salvar chave
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={!brave?.configurada}
            onClick={async () => {
              setBraveTeste('testando…');
              const r = await testarBrave();
              setBraveTeste(
                r.ok
                  ? `✓ ${r.detalhe}${r.amostra[0] ? ` — ex.: ${r.amostra[0].titulo}` : ''}`
                  : `✗ ${r.detalhe}`,
              );
            }}
          >
            Testar
          </button>
          {brave?.configurada && (
            <button
              type="button"
              className="btn-ghost"
              onClick={async () => {
                if (!confirm('Remover a chave do Brave do cofre?')) return;
                await removerChaveBrave();
                setBrave(await getBrave());
                setBraveTeste(null);
              }}
            >
              Remover chave
            </button>
          )}
          {braveTeste && <span className="text-xs text-white/60">{braveTeste}</span>}
        </div>
      </Panel>

      <Panel title="Seu perfil" icon="🪪" accent="#f5b955" right={botaoSalvar}>
        <p className="mb-4 text-xs leading-relaxed text-white/45">
          O que o agente pode digitar num site quando a tarefa pede região ou identificação — frete
          para o seu CEP, filtro por cidade. Não é segredo como a senha (ele precisa ver para digitar),
          mas é dado pessoal: <strong className="text-white/70">cada leitura fica registrada</strong>{' '}
          na trilha da sessão e no log.
        </p>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['nome', 'Nome', 'Como aparece em cadastros'],
              ['cep', 'CEP', 'Para frete e filtro por região'],
              ['endereco', 'Endereço', 'Rua e número'],
              ['cidade', 'Cidade', ''],
              ['uf', 'UF', 'Duas letras'],
              ['telefone', 'Telefone', 'Só se algum site exigir'],
              ['email', 'E-mail', 'Só se algum site exigir'],
            ] as [keyof Perfil, string, string][]
          ).map(([k, rotulo, hint]) => (
            <Field key={k} label={rotulo} hint={hint || undefined}>
              <TextInput
                value={perfil[k]}
                onChange={(e) => {
                  setPerfil({ ...perfil, [k]: e.target.value });
                  setSujo(true);
                }}
              />
            </Field>
          ))}
        </div>
      </Panel>

      <Panel
        title="O modelo"
        icon="🧠"
        accent="#f5b955"
        right={
          sujo && (
            <button
              type="button"
              className="btn-primary px-3 py-1 text-xs"
              disabled={salvando}
              onClick={() => void salvarTextos()}
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          )
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Modelo" hint="'Padrão' usa o da sua assinatura do Claude Code.">
            <Select
              value={config.modelo}
              onChange={(e) =>
                void salvar({ modelo: e.target.value as DiplomaConfig['modelo'] })
              }
            >
              <option value="default">Padrão da assinatura</option>
              <option value="claude-opus-5">Opus 5 — o mais capaz</option>
              <option value="claude-sonnet-5">Sonnet 5 — equilibrado</option>
              <option value="claude-haiku-4-5-20251001">Haiku 4.5 — rápido e barato</option>
            </Select>
          </Field>
          <Field label="Esforço de raciocínio">
            <Select
              value={config.esforco}
              onChange={(e) =>
                void salvar({ esforco: e.target.value as DiplomaConfig['esforco'] })
              }
            >
              <option value="low">Baixo</option>
              <option value="medium">Médio</option>
              <option value="high">Alto — melhor em questão difícil</option>
            </Select>
          </Field>
        </div>

        <Field
          label="Instruções permanentes"
          hint="Entram no system prompt de toda sessão. Ex.: regras da disciplina, o que nunca fazer, onde achar o material."
        >
          <TextArea
            rows={5}
            value={instrucoes}
            onChange={(e) => {
              setInstrucoes(e.target.value);
              setSujo(true);
            }}
            placeholder={'Ex.: Nunca finalize uma tentativa sem antes revisar todas as questões.\nO material de apoio fica na aba "Conteúdo" de cada módulo.'}
          />
        </Field>
      </Panel>
    </div>
  );
}
