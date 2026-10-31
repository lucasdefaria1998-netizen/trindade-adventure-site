#!/bin/sh
# Só IMPRIME os comandos do roteiro de teste do pagamento no SANDBOX do Asaas. Não executa nada,
# não lê chave nenhuma. Uso: sh scripts/roteiro-sandbox.sh https://<preview>.trindade-adventure.pages.dev
B=${1:-https://PREVIEW.trindade-adventure.pages.dev}
cat <<FIM
# Defina antes (sandbox!):  export T=<TAREFAS_TOKEN do preview>
curl -s "$B/api/disponibilidade?data=AAAA-MM-DD"
# reserva: pelo site do preview (Turnstile), escolhendo 30% ou 100%
curl -s "$B/api/pagamento?ref=<ref devolvida na reserva>"
curl -s -X POST "$B/api/tarefas/pagamento" -H "x-tarefas-token: \$T"
# a tarefa NÃO cobra saldo nem cancela: o restante (70%) é no dia do passeio
# painel (com Cloudflare Access):
#   POST $B/api/admin/reservas/<id>/saldo              link opcional do saldo (24 h)
#   POST $B/api/admin/reservas/<id>/saldo-presencial   marca o saldo recebido no dia
#   POST $B/api/admin/reservas/<id>/cancelar           estorna o sinal se faltam >= 12 h; senão, sem devolução
#   POST $B/api/admin/reservas/<id>/reagendar {"data":"AAAA-MM-DD","hora":10} | /devolver
# webhook do sandbox: CHECKOUT_PAID e, por redundância, PAYMENT_RECEIVED / PAYMENT_CONFIRMED
FIM
