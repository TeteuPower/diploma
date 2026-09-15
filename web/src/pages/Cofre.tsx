import { useState } from 'react';
import type { EstadoCofre } from '@shared/types';
import { Panel, Field, TextInput, EmptyState } from '../components/ui';
import { dataHora } from '../lib/modo';
import { guardarCredencial, removerCredencial } from '../api';

export function Cofre({
  estado,
  dominioSugerido,
  onMudou,
}: {
  estado: EstadoCofre | null;
  dominioSugerido: string;
  onMudou: () => void;
}) {
  const [dominio, setDominio] = useState('');
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [rotulo, setRotulo] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const disponivel = estado?.disponivel ?? false;

  const salvar = async () => {
    setErro(null);
    setSalvando(true);
    try {
      await guardarCredencial({
        dominio: dominio.trim() || dominioSugerido,
        usuario: usuario.trim(),
        senha,
        rotulo: rotulo.trim() || undefined,
      });
      // A senha sai do estado do React assim que sobe. Não fica em memória à toa.
      setSenha('');
      setUsuario('');
      setRotulo('');
      setDominio('');
      onMudou();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvando(false);
    }
  };

  const apagar = async (id: string, rot: string) => {
    if (!confirm(`Apagar a credencial "${rot}"?`)) return;
    try {
      await removerCredencial(id);
      onMudou();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <Panel title="Como este cofre protege" icon="🛡️" accent="#8b7bff">
        <div className="space-y-2.5 text-xs leading-relaxed text-white/55">
          <p>
            A senha é cifrada pelo <strong className="text-white/80">DPAPI do Windows</strong>,
            amarrada à sua conta. O arquivo <code className="text-white/70">data/cofre.json</code> é
            inútil em outra máquina ou em outro usuário — não há senha-mestra para lembrar nem para
            vazar.
          </p>
          <p>
            <strong className="text-white/80">A senha nunca chega à LLM.</strong> Nenhuma rota da
            API devolve senha, e o agente não tem ferramenta que a leia. Quando ele chama{' '}
            <code className="text-white/70">entrar</code>, o servidor decifra e digita direto no
            campo do navegador; o modelo recebe de volta só "deu certo" ou "falhou". No instantâneo
            que ele lê, campo de senha aparece apenas como <em>preenchido</em> ou <em>vazio</em>.
          </p>
          <p className="text-white/40">
            O que o DPAPI não protege: qualquer programa rodando como você, nesta máquina, pode
            pedir a mesma decifragem. Ele protege o arquivo, não a sessão do Windows.
          </p>
        </div>
      </Panel>

      <Panel
        title="Guardar credencial"
        icon="🔑"
        accent="#38e0d8"
        right={
          <span
            className="text-[11px]"
            style={{ color: disponivel ? '#38e0d8' : '#f47174' }}
            title={estado?.motivo ?? ''}
          >
            {disponivel ? 'DPAPI disponível' : 'DPAPI indisponível'}
          </span>
        }
      >
        {!disponivel ? (
          <EmptyState icon="🚫">
            O cofre não está disponível.
            <br />
            <span className="mt-1 block font-mono text-[11px] text-white/30">
              {estado?.motivo ?? 'motivo desconhecido'}
            </span>
          </EmptyState>
        ) : (
          <>
            <Field
              label="Domínio"
              hint={
                dominioSugerido
                  ? `Deixe vazio para usar o alvo configurado: ${dominioSugerido}`
                  : 'Ex.: ava.faculdade.edu.br'
              }
            >
              <TextInput
                value={dominio}
                onChange={(e) => setDominio(e.target.value)}
                placeholder={dominioSugerido || 'ava.faculdade.edu.br'}
              />
            </Field>

            <Field label="Usuário" hint="Identificador de login — aparece na interface, não é segredo.">
              <TextInput
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                autoComplete="off"
              />
            </Field>

            <Field label="Senha" hint="Sobe uma vez, é cifrada e nunca mais desce.">
              <TextInput
                type="password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                autoComplete="new-password"
              />
            </Field>

            <Field label="Rótulo" hint="Opcional — como você reconhece esta credencial.">
              <TextInput
                value={rotulo}
                onChange={(e) => setRotulo(e.target.value)}
                placeholder="Faculdade — conta principal"
              />
            </Field>

            {erro && (
              <p className="mb-3 rounded-lg border border-accent-rose/30 bg-accent-rose/10 p-2.5 text-xs text-accent-rose">
                {erro}
              </p>
            )}

            <button
              type="button"
              className="btn-primary"
              disabled={salvando || !usuario.trim() || !senha || (!dominio.trim() && !dominioSugerido)}
              onClick={() => void salvar()}
            >
              {salvando ? 'Cifrando…' : 'Guardar no cofre'}
            </button>
          </>
        )}
      </Panel>

      <Panel title="Credenciais guardadas" icon="📇">
        {!estado?.credenciais.length ? (
          <EmptyState icon="📭">Nenhuma credencial guardada.</EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {estado.credenciais.map((c) => (
              <li
                key={c.id}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3"
              >
                <span className="text-base">🔐</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white/85">{c.rotulo}</p>
                  <p className="truncate font-mono text-[11px] text-white/35">
                    {c.usuario} @ {c.dominio}
                  </p>
                </div>
                <div className="shrink-0 text-right text-[10px] text-white/25">
                  <div>criada {dataHora(c.criadaEm)}</div>
                  <div>{c.usadaEm ? `usada ${dataHora(c.usadaEm)}` : 'nunca usada'}</div>
                </div>
                <button
                  type="button"
                  className="btn-ghost shrink-0 px-2 py-1 text-xs"
                  onClick={() => void apagar(c.id, c.rotulo)}
                >
                  Apagar
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
