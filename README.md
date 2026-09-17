# 🎓 Diploma

Copiloto que acessa um LMS por dentro de um navegador real, lê as atividades e responde — com você
decidindo quanta corda ele tem. Roda inteiro na sua máquina: sem nuvem, sem banco, sem API key.

## Instalar

```bash
npm install
npm run navegador     # baixa o Chromium do Playwright (uma vez)
```

A LLM autentica pela **assinatura do Claude Code**. Se ainda não logou nesta máquina:

```bash
claude       # loga uma vez; o SDK reaproveita a credencial
```

## Rodar

```bash
npm run dev           # interface em http://localhost:5980
```

Em produção, `npm run build && npm start` sobe um processo só em `http://localhost:8980`.

## Os três passos da primeira vez

1. **Configuração → aponte o domínio.** Esse endereço vira a fronteira do agente: ele não navega
   para fora dali. A trava é código, não instrução.
2. **Cofre → guarde a credencial.** Ela é cifrada pelo DPAPI do Windows, amarrado à sua conta. O
   arquivo é inútil em outra máquina, e **a senha nunca chega à LLM** — o servidor digita direto no
   navegador e o modelo só recebe "deu certo" ou "falhou".
3. **Painel → descreva o objetivo.** Ex.: *"Entrar no curso Segurança da Informação, abrir o módulo
   3 e responder o questionário de fixação."*

## Os quatro modos

| Modo | O que ele faz |
|---|---|
| 👁️ **Observar** | Navega e lê, mas nenhuma ação acontece. Descreve o que faria; você executa. |
| 🤝 **Assistido** | Age para navegar e preencher, mas para e espera sua aprovação antes de qualquer coisa que mude o estado no LMS. |
| 🎚️ **Guiado** | Opera sozinho. Só as ações que você marcar param para aprovação. |
| 🚀 **Autônomo** | Ponta a ponta, sem parar. |

Começa em **Assistido** de propósito — vale ver o agente acertar algumas vezes antes de soltar.

Enquanto um pedido de aprovação está aberto, o agente está **literalmente parado**: a ferramenta
dele fica bloqueada esperando seu clique. Você lê exatamente o que vai ser enviado antes de decidir.
Silêncio não é consentimento: se ninguém responde no prazo, a ação é recusada.

Precisa travar tudo de fora? `DIPLOMA_MODO=observar` ganha da configuração.

## Como ele enxerga a página

Não por screenshot — por árvore de acessibilidade:

```
- titulo "Questionário do módulo 3" [nivel=2]
- radio "Enganar a pessoa para que ela entregue dados" ref=e2 [desmarcado]
- lista "Selecione o protocolo seguro:" ref=e5
    - opcao "HTTPS" valor="https"
- botao "Finalizar tentativa" ref=e9
```

Cada elemento acionável ganha um `ref`, e é por ele que o agente age. Custa uma fração dos tokens de
uma imagem, não depende de coordenada e funciona dentro de iframe — que é onde a maior parte do
conteúdo de LMS mora (SCORM, H5P, vídeo). Screenshot fica para o que sobra: questão em gráfico.

## Missões web

O LMS virou um módulo. A outra missão é **web**: pesquisar preços, ler uma conta sua, encontrar
informação — em qualquer site https, salvo política que você escolher na hora de criar a sessão:

- **Aberta** (padrão): qualquer site https. Ele descobre onde procurar sozinho — começando por um
  buscador quando não sabe.
- **Lista**: só os hosts que você informar (ou a lista global da Configuração).

Em qualquer política: nada de http em claro, e a **credencial do cofre só é digitada no site dela**.
Uma sessão roda por vez — o navegador é um só.

O que ele encontra vira **achado**, com a URL de onde saiu, na aba **Achados**: produto vira tabela
ordenada por preço; fato, documento e contato viram cartão com a fonte ao lado. Sem fonte, a
ferramenta recusa.

Na Configuração você preenche o **Perfil** (CEP, cidade, endereço) para ele filtrar por região —
cada leitura fica registrada na trilha — e a chave do **Brave Search**, que vai para o cofre e
nunca chega à LLM: ele só recebe os resultados.

Exemplos que funcionam como pedido:

> Pesquise os melhores preços do tablet Samsung Galaxy Tab S8, novo, com frete para o meu CEP.

> Encontre a VM mais barata para hospedar um modelo de 350B parâmetros. Não sei por onde começar.

> Acesse meu processo no Jusbrasil (credencial no cofre) e me dê um resumo de como está.

## A aba Entrega

Quando ele termina de produzir os trabalhos, a aba **Entrega** mostra o que a aplicação conferiu
**no disco** — não o que o agente disse que fez:

- cada atividade, seus arquivos e o pacote gerado
- se o PDF é um PDF de verdade (assinatura conferida, não a extensão)
- **o que está dentro de cada ZIP**, para você ver que nenhum recado interno viajou junto
- os trechos que parecem recado ao dono e ainda estão dentro de um arquivo de entrega
- e, separado de tudo isso, o que depende de você — que o agente guarda em `_notas/`, fora da entrega

## Validar

```bash
npm run typecheck
npm run build
npm run teste     # sobe um LMS falso e confere o comportamento real
```

O `npm run teste` prova, entre outras coisas, que a senha digitada **não aparece** no que a LLM lê.

## O que ele não faz

- **Captcha e 2FA:** ele para e te chama. A janela fica aberta para você resolver na mão.
- **Adaptador de LMS específico:** é genérico — funciona em qualquer plataforma, ao custo de ser
  menos certeiro que um adaptador que conhecesse as URLs de um Moodle.
- **Decidir por você se o uso é adequado.** Os modos existem para essa escolha ser sua, explícita e
  a cada ação. Automatizar avaliação de terceiro costuma esbarrar nos termos de uso do LMS e em
  política de integridade acadêmica.

---

Stack: Node + Express + `@anthropic-ai/claude-agent-sdk` · Vite + React + Tailwind · Playwright ·
DPAPI. Detalhes de arquitetura em [CLAUDE.md](CLAUDE.md).
