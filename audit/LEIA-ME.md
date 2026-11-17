# Lighthouse antes × depois (auditoria 16/11)

Fora de `site/`: nada aqui é publicado.

- `antes/`: base de produção (4839594). `depois/`: esta branch.
- Rotas: `/`, `/passeios/essencial`, `/reservar`, `/contato`.
- Comando de cada rodada:
  `lighthouse <url> --preset=perf --form-factor=mobile --throttling-method=simulate --output=json`
- 5 rodadas por rota e lado, alternando antes/depois para dividir o ruído da máquina (`medir.sh`).
  O arquivo `<rota>.json` é a rodada de nota mediana; a tabela abaixo é a mediana de cada métrica (`resumir.mjs`).
- `acessibilidade-<rota>.json`: uma rodada só de acessibilidade por rota e lado.
- Servidores locais: `wrangler pages dev site` (antes em :8796, depois em :8795). Pedidos externos (Google Fonts,
  open-meteo) variam muito a partir desta máquina; por isso a mediana.

| Rota | Perf | LCP | TBT | CLS | HTML |
|---|---|---|---|---|---|
| / | 88 → 88 | 3,29 → 2,66 s | 307 → 279 ms | 0,000 → 0,000 | 165,8 → 199,3 KiB |
| /passeios/essencial | 86 → 89 | 3,98 → 2,69 s | 158 → 357 ms | 0,000 → 0,000 | 166,4 → 203,0 KiB |
| /reservar | 93 → 89 | 2,26 → 1,83 s | 216 → 370 ms | 0,088 → 0,088 | 165,5 → 199,1 KiB |
| /contato | 99 → 99 | 2,19 → 1,58 s | 42 → 103 ms | 0,000 → 0,000 | 165,6 → 195,7 KiB |

Acessibilidade: 100/99/100/100 → 100/100/100/100. Recursos que bloqueiam a renderização: antes `boot.js` e
`estilo.css`; depois nenhum.

O HTML cresceu ~33 KiB (CSS crítico inline do P1.2 e `srcset` maiores do P1.4). O TBT subiu porque a primeira
pintura chega ~250 ms antes e o recálculo de estilo do `estilo.css` assíncrono passou a cair dentro da janela do
TBT; o trabalho total da thread principal ficou igual. O que reduz HTML, TBT e o LCP da `/passeios/essencial` é o
P1.1 (rotas fora do index.html), que vai em PR separado.

Para refazer:

    FERRAMENTAS=<pasta com node_modules/lighthouse> bash audit/medir.sh /tmp/lh
    node audit/resumir.mjs /tmp/lh --copiar audit
