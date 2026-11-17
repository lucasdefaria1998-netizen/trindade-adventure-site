#!/usr/bin/env bash
# Lighthouse mobile (perf) antes × depois, 5 rodadas por rota, alternando servidores para dividir o ruído da máquina.
# Uso: FERRAMENTAS=<pasta> bash audit/medir.sh <pasta-saida>   (antes em :8796, depois em :8795, os dois com wrangler pages dev)
set -u
FERRAMENTAS=${FERRAMENTAS:?pasta com node_modules/lighthouse}
LH=$FERRAMENTAS/node_modules/.bin/lighthouse
export CHROME_PATH=/usr/bin/google-chrome
OUT=${1:?pasta}
mkdir -p "$OUT/antes" "$OUT/depois"
for n in 1 2 3 4 5; do
  for rota in / /passeios/essencial /reservar /contato; do
    nome=$(echo "$rota" | sed 's#^/$#home#; s#^/##; s#/#-#g')
    for lado in antes depois; do
      porta=$([ $lado = antes ] && echo 8796 || echo 8795)
      "$LH" "http://127.0.0.1:$porta$rota" --preset=perf --form-factor=mobile --throttling-method=simulate \
        --output=json --output-path="$OUT/$lado/$nome-$n.json" --quiet \
        --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage" || echo "FALHOU $lado $rota $n"
      echo "ok $lado $rota $n"
    done
  done
done
# acessibilidade (não pode cair de 95): uma rodada por rota e lado
for rota in / /passeios/essencial /reservar /contato; do
  nome=$(echo "$rota" | sed 's#^/$#home#; s#^/##; s#/#-#g')
  for lado in antes depois; do
    porta=$([ $lado = antes ] && echo 8796 || echo 8795)
    "$LH" "http://127.0.0.1:$porta$rota" --only-categories=accessibility --form-factor=mobile \
      --output=json --output-path="$OUT/$lado/a11y-$nome.json" --quiet \
      --chrome-flags="--headless=new --no-sandbox --disable-dev-shm-usage" || echo "FALHOU a11y $lado $rota"
  done
done
echo FIM
