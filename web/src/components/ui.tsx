import type {
  ReactNode,
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
} from 'react';

export function Panel({
  title,
  icon,
  accent,
  right,
  children,
  className = '',
}: {
  title?: ReactNode;
  icon?: ReactNode;
  accent?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass p-5 ${className}`}>
      {(title || right) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            {icon && (
              <span
                className="grid h-8 w-8 place-items-center rounded-lg text-lg"
                style={{ background: accent ? `${accent}22` : 'rgba(255,255,255,0.06)' }}
              >
                {icon}
              </span>
            )}
            {title && <h2 className="text-sm font-semibold tracking-wide text-white/80">{title}</h2>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mb-4">
      <label className="label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-white/35">{hint}</p>}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`glass-input w-full ${props.className ?? ''}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`glass-input w-full resize-y leading-relaxed ${props.className ?? ''}`}
    />
  );
}

export function Select({
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <select {...props} className={`glass-input w-full ${props.className ?? ''}`}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  danger,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left transition hover:bg-black/30"
    >
      <span>
        <span className="block text-sm font-medium text-white/85">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-white/40">{hint}</span>}
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? (danger ? 'bg-accent-rose/80' : 'bg-accent/80') : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  );
}

export function Badge({ children, color }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        background: color ? `${color}22` : 'rgba(255,255,255,0.08)',
        color: color ?? 'rgba(255,255,255,0.7)',
      }}
    >
      {children}
    </span>
  );
}

export function EmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-white/40">
      {icon && <div className="text-3xl opacity-60">{icon}</div>}
      <div>{children}</div>
    </div>
  );
}

/** Cartão de escolha — usado para o modo de autonomia, onde a diferença importa. */
export function OptionCard({
  selecionado,
  onClick,
  titulo,
  descricao,
  icone,
  cor,
}: {
  selecionado: boolean;
  onClick: () => void;
  titulo: string;
  descricao: string;
  icone: string;
  cor: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-xl border p-4 text-left transition ${
        selecionado
          ? 'border-transparent bg-white/[0.07]'
          : 'border-white/10 bg-black/20 hover:bg-black/30'
      }`}
      style={selecionado ? { borderColor: cor, boxShadow: `0 0 24px -10px ${cor}` } : undefined}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="text-base">{icone}</span>
        <span
          className="text-sm font-semibold"
          style={{ color: selecionado ? cor : 'rgba(255,255,255,0.85)' }}
        >
          {titulo}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-white/45">{descricao}</p>
    </button>
  );
}
