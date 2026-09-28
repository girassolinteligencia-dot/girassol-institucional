# CLAUDE.md — Girassol Inteligência (site institucional)

Antes de criar, editar ou revisar qualquer texto, layout ou peça deste site, leia inteiro:

```text
human-output/dna/girassol-inteligencia/dna-criativo/DNA.md
```

O `DNA.md` é a fonte da verdade da marca. Se um pedido contradizer o DNA, sinalize a tensão e proponha um caminho coerente; se a mudança for aprovada, atualize o DNA.

## Resumo

```text
Marca: Girassol Inteligência — consultoria de tecnologia
O que faz: mapeia processos e desenvolve com IA ferramentas sob medida que pertencem ao cliente
Promessa: Sua ideia vira ferramenta — e a ferramenta é sua.
Estética: híbrida — off-white #FAF7F0, tinta #1C1812, seções escuras #2B1D0E, acento girassol #F2B705 (âmbar #9A6400 sobre claro)
Logos: girassol+cérebro SEMPRE com o nome "Girassol Inteligência"; ícone "gi" para favicon/ícones/avatar
Tipografia: IBM VGA (bitmap, só múltiplos de 16px) em todo o site — crédito CC BY-SA no rodapé
Temas: site claro por padrão + seletor escuro; admin escuro por padrão
Voz: consultoria formal, primeira pessoa do plural, técnica só como prova
Protagonista: a equipe (fundador com discrição)
CTA único: chat com IA — "Iniciar diagnóstico"
```

## Regras rápidas

- Nunca: neon/brilho, gíria, emojis, "compre agora", jargão como título, fundador em destaque, múltiplos CTAs.
- Produtos = "Soluções desenvolvidas" (prova de capacidade adaptável).
- Site em `public/` (só essa pasta é publicada). Worker em `src/index.js` (API de métricas, leads e painel) com banco D1 (`migrations/`). Painel em `public/admin.html`, protegido pelo Cloudflare Access.
