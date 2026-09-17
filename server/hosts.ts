/**
 * "https://www.olx.com.br/x" → "olx.com.br". Host limpo, sem esquema, sem www,
 * sem porta. É a forma canônica que a política de domínio compara — o dono
 * cola uma URL inteira na allowlist e ela tem que casar com o host que o
 * navegador vê.
 */
export function normalizarHost(bruto: string): string {
  let h = bruto.trim().toLowerCase();
  try {
    if (h.includes('://')) h = new URL(h).host;
  } catch {
    /* segue com o texto cru */
  }
  return h
    .replace(/^www\./, '')
    .replace(/[/:].*$/, '')
    .replace(/[^a-z0-9.-]/g, '');
}
