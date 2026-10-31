# Trindade Adventure — site

Site com um pé em cada mundo: as páginas são arquivos estáticos (HTML/CSS/JS),
mas desde setembro de 2026 existe também um backend real — um banco de dados
que grava as reservas de verdade e um painel para a operação acompanhar. Não
precisa de Node, npm nem build: publicar continua sendo arrastar a pasta no
Cloudflare Pages.

**Estrutura desta pasta (desde 05/10/2026):** só o conteúdo de `site/` vai
para o Cloudflare. `testes/` e este LEIA-ME ficam fora do deploy.

## Arquivos (dentro de `site/`)

| Arquivo | O que é |
|---|---|
| `index.html` | Todo o conteúdo do site: roteiros, preços, textos, perguntas frequentes, Termos do Passeio e Política de Privacidade. No `<head>`, a tabela `site-config` lista cada página (endereço, título, descrição, imagem de pré-visualização) e os dados da empresa. |
| `404.html` | Página de erro de reserva. A existência dela é o que impede o Cloudflare de responder a página inicial para endereço que não existe — não apague. |
| `estilo.css` | Cores, tipografia e layout. |
| `boot.js` | Roda antes do primeiro desenho: marca JavaScript, tema e preferência de movimento, e ativa a fonte. Sem `defer`, no `<head>`. |
| `app.js` | Comportamento do site público: navegação, tempo e mar ao vivo, montador de reserva, mapa, envio para a API. |
| `motion.js`, `pescaria-galeria.js` | Acabamento: rolagem suave e revelação ao rolar; galeria da pescaria. O site funciona sem eles. |
| `_worker.js` | O backend. Um arquivo só, porque o deploy por arraste-e-solta do Cloudflare não compila a pasta `/functions` — só aceita `_worker.js`. Responde `/api/*` (reservas, disponibilidade, painel), entrega cada página com título e metadados próprios e responde 404 de verdade para endereço ou arquivo que não existe. |
| `admin.html` | O painel da operação (agenda, reservas, origem dos clientes, ajustes). Só abre para quem faz login — ver seção "Painel da operação" abaixo. |
| `assets/` | Fotos. `og-v2.jpg` é a imagem que aparece quando alguém cola o link no WhatsApp. |
| `vendor/` | Leaflet 1.9.4, a biblioteca do mapa, servida pelo próprio site. Não editar. |

**Por que os arquivos de foto terminam em `-v2`:** um deploy antigo subiu quebrado
e os navegadores que passaram por ele guardaram o erro por um ano (`immutable`
no `_headers`). Renomear foi o único jeito de furar esse cache. Se um dia
precisar trocar uma foto, troque também o nome do arquivo — `praia-v3.jpg` — e
atualize as referências no `index.html`. Reaproveitar o nome antigo faz o
visitante continuar vendo a foto velha.
| `_headers` | Regras de cache e segurança aplicadas pelo Cloudflare. |
| `robots.txt`, `sitemap.xml` | Instruções para o Google. |

## Painel da operação

**Endereço:** `https://trindadeadventury.com.br/admin` (até o domínio entrar no ar: `https://trindade-adventure.pages.dev/admin`).
Sem a variável `ACCESS_AUD` configurada o painel responde 403 — ver "Painel: checagem dupla" abaixo.

O painel pede login por e-mail (Cloudflare Access) — sem senha para lembrar:
você digita o e-mail, chega um código de 6 dígitos, você digita o código.
Hoje só **lucasdefaria1998@gmail.com** está autorizado. Para liberar outra
pessoa (o guia, um sócio), é no painel do Cloudflare:

**Zero Trust → Access → Aplicações → "Painel Trindade Adventure" → editar a
política "Dono do negócio" → adicionar o e-mail da pessoa na regra de E-mails.**

Dentro do painel:

- **Hoje & agenda** — quem reservou para hoje, e a ocupação de cada horário
  nos próximos 7 dias. Dá para bloquear um horário (ou o dia inteiro) direto
  daqui — útil pra previsão de mar ruim ou pra folga do guia.
- **Reservas** — lista completa, com filtro por data e status. Confirmar,
  marcar "faltou" ou cancelar muda o status que o cliente veria se perguntasse.
  "+ Reserva manual" lança uma reserva feita por telefone ou no balcão.
- **Origem** — de onde vieram as reservas (Instagram, Google, indicação,
  direto), o funil completo (visitou → abriu a reserva → enviou o pedido →
  confirmou), e a lista de quem marcou que segue o Instagram — com o @ de
  cada um, para conferir na sua lista de seguidores antes de mandar as fotos
  prometidas.
- **Ajustes** — vagas por horário, horário de saída, WhatsApp, Instagram,
  cupom das pousadas e o texto do benefício de seguir. Muda na hora, sem
  precisar publicar o site de novo.

## Como o site sabe de onde veio o cliente

`app.js` guarda, na primeira visita, se a pessoa veio do Instagram, do Google,
de um link marcado (`?fonte=bio-instagram` na bio, por exemplo) ou digitou o
endereço direto. Isso viaja com a reserva e aparece no painel e na própria
mensagem do WhatsApp, numa seção "— controle interno —" no fim.

Um relato do próprio cliente ("como você conheceu a gente?", no passo 5 da
reserva) só sobrescreve essa detecção quando ela veio fraca — nunca apaga um
clique de fato rastreado vindo do Instagram.

**O convite para seguir o Instagram não é verificado de verdade** — não existe
como um site confirmar isso. O cliente se autodeclara ("já sigo / segui
agora"), o @ dele fica registrado, e cabe a quem opera conferir na lista de
seguidores antes de entregar o benefício (hoje: as fotos do passeio).

## Como mudar as coisas mais comuns

**Preço de um passeio** — está em quatro lugares, todos precisam bater:
1. `index.html`, no bloco `application/ld+json` do topo (é o que o Google lê);
2. `index.html`, no cartão do roteiro (`<div class="preco"><b>R$ 150</b>`);
3. `app.js`, na lista `PLANOS` (o que o site mostra antes de falar com o servidor);
4. `_worker.js`, na constante `PLANOS` (esse é o que **vale de verdade** — é
   o preço que entra na reserva gravada e na mensagem do WhatsApp, mesmo que
   alguém adultere o preço mostrado na tela pelo navegador).

Mude os quatro juntos. É a dívida técnica mais chata do projeto — um dia vale
a pena os três primeiros lerem o preço do `_worker.js` por uma chamada, em vez
de repetir o número.

**Telefone do WhatsApp** — `app.js`, em `CFG.whatsapp`, no formato
`5524992073621` (55 + DDD + número, só dígitos). Troque também o texto visível
em `index.html` (busque por `99207-3621`) e o `telephone` do bloco JSON-LD.

**Horários de saída** — `app.js`, em `CFG.slotInicio` e `CFG.slotFim` (e no
painel, Ajustes). Para um passeio com saída própria, use o campo `horarios` do
plano: `[8.5]` é 08:30.

**Duração e última saída de cada passeio** — cada plano tem `duracaoMin` em
`PLANOS` (no `_worker.js`, que vale, e no `app.js`). Um horário só é
oferecido se o passeio terminar até o **horário-limite de retorno**:

    concentração + saída (20 min) + duração ≤ retorno_limite

O padrão é 18:20 — o retorno da saída mais tarde que o Essencial (≈ 3h) já
tinha às 15:00. Com isso o Adventure (≈ 6h) vai até 12:00. Para mudar sem
publicar: painel → Ajustes → "Retorno até". Não é o pôr do sol (que muda o
ano todo); é um horário fixo da operação. Um plano também pode ter
`ultimaSaida` para cortar a grade num horário específico.

**Trindade Boat (desde 24/10/2026): dois horários fixos, 08:30 e 11:00**
(`horarios: [8.5, 11]` em `PLANOS`, nos dois arquivos). A concentração das
11h, mais a duração do Boat (≈ 8h), passaria do horário-limite de retorno
padrão — a operação pediu o horário mesmo assim, então esse plano tem também
`semCorteRetorno: true`, que faz a lista fixa de horários ignorar a regra do
horário-limite (só vale pra ele; os outros planos continuam seguindo a
regra normal). Mude os dois arquivos juntos, como em qualquer horário fixo.

**Voo de Parapente no `/reservar`** — não é um "plano" de verdade no
`_worker.js` (não tem agenda nem vaga: `app.js` PLANOS tem uma entrada
`parapente` só para aparecer como opção no passo 1, com `soWhatsApp: true` e
`horarioCombinado: true`). Ao escolher parapente, o passo "Horário" vira um
aviso ("combinado pelo WhatsApp") em vez da grade, aparece um campo
obrigatório de peso, e o envio pula o Turnstile e o `POST /api/reservas`:
vai direto para o WhatsApp. O JSON-LD de `/voo-de-parapente` (TouristTrip +
Offer, 350 BRL) vem de uma tabela à parte no `_worker.js`,
`OFERTAS_SO_WHATSAPP` — não de `PLANOS`.

**Texto de uma página no Google/WhatsApp** — tabela `site-config` no
`<head>` do `index.html`: `titulo`, `descricao`, `imagem` (JPG). Algumas
descrições citam preço (Essencial, Adventure, Boat, Pescaria): ao mudar um
preço, mude também ali. Página nova = entrada nova na tabela + seção com
`data-secao` no HTML + linha no `sitemap.xml`.

**CNPJ, razão social, Cadastur** — `negocio` na mesma tabela `site-config`.
Campo vazio não aparece no rodapé. O CNPJ também está no JSON-LD (`taxID`).

**Cupom das pousadas** — `CFG.cupom` em `app.js` e o texto em `index.html`.

Depois de qualquer alteração, publique de novo (seção abaixo).

## Endereços do site, 404 e cache

Até 05/10/2026 o site navegava por `#/` (`/#/passeios?plano=adventure`).
Agora cada página tem endereço próprio: `/passeios`, `/passeios/adventure`,
`/passeios/juatinga`, `/reservar`, `/pousadas`, `/pescaria`, `/historia`,
`/contato`, `/cameras`, `/termos-do-passeio`, `/politica-de-privacidade`.
Links antigos com `#/` continuam funcionando — o `app.js` converte na hora,
mantendo `?fonte=` do rastreamento.

- Endereço fora da tabela `site-config` → página "não encontrada", **status 404**.
- Arquivo inexistente (`/assets/x.webp`, `/x.js`…) → **404** em texto, com
  `Cache-Control: no-cache`. Nunca mais o HTML da página inicial com cache de
  um ano.
- `/cameras` sai com `noindex` e fora do sitemap enquanto não houver câmera real.

### Regra: mudou o arquivo, mude o `?v=`

`boot.js`, `app.js`, `motion.js`, `pescaria-galeria.js` e `estilo.css` são
chamados no `index.html` com `?v=…`. Quando o pedido traz `?v=` (formato
`A-Z a-z 0-9 . _ -`, até 40 caracteres), o `_worker.js` responde
`Cache-Control: public, max-age=31536000, immutable`: o navegador guarda por um
ano e **só busca de novo se o `?v=` mudar**. Sem `?v=`, vale o cache curto de
1 dia do `_headers`. HTML, `/api/*`, `sitemap.xml`, `robots.txt` e `/admin` não
mudam.

Por isso, **alterou qualquer um desses cinco arquivos? Troque o `?v=` dele no
`index.html`** (ex.: `20261020-s17`), senão quem já visitou fica com a versão
antiga por até um ano — inclusive com um bug de reserva. O script
`testes/check-versao.mjs` confere (e é rodado antes de cada commit): falha se o
conteúdo mudou sem o `?v=` mudar.

    node testes/check-versao.mjs              # conferir
    node testes/check-versao.mjs --atualizar  # depois de trocar o ?v=, registrar no versoes.json

O registro (`?v=` + hash do conteúdo) fica em `versoes.json`, na raiz do
repositório (fora de `site/`, não é publicado).

### Política de segurança de conteúdo (CSP) — por enquanto só observando

Toda página HTML do site (não `/admin`, não arquivos, não `/api/*`) sai com
`Content-Security-Policy-Report-Only` (a constante `CSP_SITE` do `_worker.js`) e
`Reporting-Endpoints: csp="/api/csp-report"`. **Nada é bloqueado**: o navegador só
avisa o que bloquearia. A política libera o próprio domínio e os hosts que o
site usa: Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`), mapa
(`tile.openstreetmap.org`, sem `*.`), clima (`api.open-meteo.com`,
`marine-api.open-meteo.com`) e o Turnstile (`challenges.cloudflare.com`).
`script-src` **nunca** leva `'unsafe-inline'`, `'unsafe-eval'` nem `'unsafe-hashes'`;
o site não tem `<script>` nem `style=` inline (o tema vem de `/boot.js`).

`POST /api/csp-report` recebe os avisos (`application/csp-report` ou
`application/reports+json`, até 8 KB, 30 por minuto por IP) e responde 204. Do
relatório só ficam quatro dados, **no log do Worker** (não no banco): diretiva,
recurso bloqueado sem query string, caminho da página sem host nem query, e a hora.
Para ler: painel Cloudflare → Workers e Pages → projeto → **Logs** (em tempo real),
ou `npx wrangler pages deployment tail`; procure linhas que começam com `[csp]`.
O Chrome só entrega relatórios da Reporting API (`report-to`) por HTTPS; em
`http://localhost` o aviso aparece no console, mas não chega ao endpoint.

Passar para "valendo" (enforce) é trocar o nome do header para
`Content-Security-Policy` em `comHeadersSeguranca` — só depois de ~7 dias de
tráfego real sem avisos legítimos (Etapa 25 do plano; ainda **não** feito).
O `X-Frame-Options` continua, porque `frame-ancestors` não vale em Report-Only.

## Testar antes de publicar

Com Node instalado, a partir da pasta `testes/` (banco D1 **local**, nada vai
para a produção):

    npx wrangler d1 execute trindade-local --local --file schema-local.sql
    npx wrangler pages dev --port 8788

e, em outro terminal, na pasta do projeto:

    node testes/testar-http.mjs http://127.0.0.1:8788

São ~580 verificações: 404, cache, headers de segurança e CSP, título/descrição/canonical/OG de cada
página, JSON-LD, sitemap, textos legais, imagens, e a regra de horários (inclusive reservas de teste no banco
local). Contra o site no ar (`node testes/testar-http.mjs https://trindade-adventure.pages.dev`)
os testes que gravam reserva são pulados automaticamente.

Outro conjunto, só da API (portão dos POST, limite por IP, validação…), só
localhost — grava no D1 local e confere a contagem de linhas:

    node testes/testar-api.mjs
    node testes/check-versao.mjs

Pagamento online (Asaas, só Pix) — sem wrangler e sem rede, com Node 22.5+ (usa `node:sqlite`):

    node testes/testar-pagamento.mjs            # regra 30/100, crianças até 12 anos, webhook CHECKOUT e PAYMENT_*, saldo no dia, estorno até 12 h (Asaas simulado)
    node testes/testar-pagamento-desligado.mjs  # desligado = mesmas respostas do d1ad1fc e nenhuma SQL da migração 0003

Para publicar e para ligar o pagamento: variáveis, migração 0003, webhook e agendador estão nos comentários do
`_worker.js` (seção do pagamento) e no roteiro `scripts/roteiro-sandbox.sh` (só imprime).

(`testar-api` tem ~250 verificações: portão dos POST, limite por IP, Turnstile, idempotência, painel com JWT de teste,
`/api/csp-report`, redirecionamento de domínio.) Se rodar `testar-api` duas vezes em menos de 1 minuto, o worker
ainda guarda os certificados de teste da rodada anterior (por até 60 s) e as chamadas do painel falham: espere.

O teste ponta a ponta da reserva no navegador está em
`testes/e2e-reserva.browser.js` (cole no console de http://127.0.0.1:8788/reservar;
ele troca o `window.open` por um stub e nunca abre o WhatsApp).

### Variáveis do projeto no Cloudflare Pages

| Variável | Para quê | Se faltar |
|---|---|---|
| `ORIGENS_PERMITIDAS` | Origens que podem fazer POST em `/api/reservas` e `/api/eventos`, separadas por vírgula. Aceita `https://*.trindade-adventure.pages.dev` para os endereços de preview. Configure em **Produção** e em **Preview**. | Vale a lista de produção embutida no `_worker.js` (`trindadeadventury.com.br` e `trindade-adventure.pages.dev`): um preview recebe 403 no POST até a variável ser configurada. |
| `TURNSTILE_SITEKEY` | Sitekey **pública** do widget Turnstile (desafio anti-robô da reserva). O `_worker.js` coloca este valor no `<meta name="turnstile-sitekey">`; sem ela vale a chave de teste que vem no `index.html`. Hostnames do widget: `trindadeadventury.com.br`, `www.trindadeadventury.com.br`, `trindade-adventure.pages.dev`. | Widget de teste (sempre "passa"): com o segredo real, toda reserva online é recusada (403) e o site segue pelo WhatsApp. |
| `TURNSTILE_SECRET` | Segredo do Turnstile (**Secret**, nunca no repositório nem no chat). Configure em Produção e em Preview, junto com a sitekey. | **Reserva online fechada** (503): o site cai sozinho no fluxo de WhatsApp, sem gravar no painel. Configure antes de publicar. |
| `ACCESS_AUD` | **Obrigatória para o painel.** O "Application Audience (AUD) Tag" do aplicativo do Cloudflare Access (Zero Trust → Access → Applications → o aplicativo do painel → Overview). O `_worker.js` confere o JWT que o Access envia (assinatura, audiência, emissor, validade). Configure em Produção **e** em Preview, como variável/secret — nunca no `index.html`, `app.js` ou `admin.html`. | **`/admin` e `/api/admin/*` respondem 403 para todo mundo** (inclusive para você). Configure antes de publicar. |
| `REDIRECIONAR_PARA_DOMINIO` | `1` liga o redirecionamento **301** de `trindade-adventure.pages.dev` e `www.trindadeadventury.com.br` para `https://trindadeadventury.com.br` (caminho e query preservados; só GET/HEAD). Ligue **só em Produção** e **só depois** de o domínio responder com HTTPS (DNS, certificado, custom domains `trindadeadventury.com.br` e `www`). Previews por hash/branch, localhost e o próprio domínio oficial nunca redirecionam. | Desligado: nada redireciona e o site responde nos dois endereços. |
| `TURNSTILE_HOSTNAMES` | (Opcional) Hosts aceitos na verificação, separados por vírgula. | Vale a lista de produção e qualquer subdomínio de `trindade-adventure.pages.dev` (previews). |

O limite de pedidos por IP usa a tabela `rate_limit` do D1 (criada sozinha pelo
`_worker.js`; o SQL está em `migracoes/0001_rate_limit.sql`).

## Publicar uma nova versão

Cloudflare Pages → projeto `trindade-adventure` → **Create deployment** →
arraste a pasta **`site`** (ou um `.zip` do conteúdo dela, incluindo
`_worker.js`, `404.html` e `admin.html`).
A publicação leva menos de um minuto e a versão anterior fica guardada, então
dá para voltar atrás com um clique.

O banco de dados (D1) e o login do painel (Access) são configurados **uma vez
só**, direto no painel do Cloudflare, e sobrevivem a qualquer novo deploy —
não precisa reconfigurar nada disso ao publicar uma atualização normal do
site. Só mexa neles de novo se for trocar de banco ou de política de acesso.

## Pendências antes de divulgar o link

1. **Uma pousada ainda é fictícia.** "Vila Caiçara Trindade" existe só para
   mostrar o formato do cartão e está marcada com o selo *Exemplo*. Substitua
   por uma parceira real ou apague o bloco `<article>` em `index.html`
   (`data-cena="pousada_c"`). A outra pousada de exemplo que existia,
   "Recanto da Praia Brava", já foi substituída por uma parceira real (Casa
   de Madeira Trindade — ver seção de parceiros abaixo).
2. **As câmeras não existem.** A seção está marcada como demonstração. Quando
   houver câmera de verdade, ela precisa de uma URL de transmissão HLS e o
   quadro passa a exibir vídeo real. Enquanto isso, considere esconder a aba.
3. **Domínio próprio — falta um passo no Registro.br.** (O código já aponta para `https://trindadeadventury.com.br`; veja "Domínio oficial e e-mails" ao final e publique só com o domínio no ar.) O domínio é
   `trindadeadventury.com.br` (com *y*). Ele está cadastrado na Cloudflare,
   mas a zona continua **pendente**: o domínio ainda usa o DNS do Registro.br
   (`a.auto.dns.br` e `b.auto.dns.br`), então a Cloudflare não consegue provar
   a posse e recusa ligar o domínio ao site.

   Para destravar, entre em **registro.br → seu domínio → Alterar servidores
   DNS** e troque os dois servidores atuais por:

   ```
   apollo.ns.cloudflare.com
   leia.ns.cloudflare.com
   ```

   A propagação leva de 1 a 24 horas. Nada quebra nesse meio-tempo: os
   registros de e-mail (MX, SPF, DMARC) já foram copiados para a Cloudflare, e
   hoje não existe nenhum site nem Worker respondendo nesse domínio.

   Quando a Cloudflare mostrar a zona como **ativa**, faltam: Pages →
   `trindade-adventure` → Custom domains → adicionar `trindadeadventury.com.br` e
   `www.trindadeadventury.com.br`; criar as caixas `contato@` e `suporte@`; e só então
   publicar e ligar `REDIRECIONAR_PARA_DOMINIO=1` (tabela de variáveis). A troca de endereço no
   `index.html`, `robots.txt` e `sitemap.xml` já está feita no repositório.
4. **Cadastur: o número estava errado (era igual ao CNPJ) e foi retirado em 24/10/2026.** A busca
   pública mostra outra empresa homônima ("Trindade Adventure Ltda", de Bragança Paulista/SP, CNPJ
   diferente) — por isso o número 64.565.826/0001-80 não podia continuar valendo como Cadastur. Hoje
   `negocio.cadastur` (tabela `site-config`) está vazio: sem Cadastur, nada aparece no rodapé nem no
   JSON-LD (campo vazio não imprime). Quando o Cadastur certo chegar, preencha só ali — tem um
   comentário `TODO(cadastur)` acima da tabela `site-config` lembrando disso. Razão social e CNPJ
   continuam normais: 64.565.826 IGOR SANTIAGO FRAGA · CNPJ 64.565.826/0001-80.

## Parceiros reais no site

- **Restaurante Hymbé, na praia** (`@hymberestaurantepraia`) — onde o voucher
  de almoço dos roteiros Adventure e Boat é usado. Tem um bloco próprio na
  página de Passeios, logo depois dos três roteiros, com galeria de fotos.
- **Pousada Hymbé Trindade** — já existia no site; a foto placeholder foi
  trocada por uma galeria de fotos reais da pousada.
- **Casa de Madeira Trindade** (`@demadeiratrindade`, WhatsApp
  `5524987873576`) — pousada parceira nova, na página de Pousadas.

O botão "Falar" de cada pousada manda a mensagem pelo WhatsApp *da própria
pousada*, não pelo da operação — isso é o atributo `data-wa-numero` no
`<a>`, que sobrescreve o número padrão (`CFG.whatsapp`) só para aquele link.
Se adicionar uma pousada nova com WhatsApp próprio, use o mesmo padrão;
sem `data-wa-numero`, o link cai no WhatsApp da Trindade Adventure.

As galerias de foto (Hymbé, Casa de Madeira, Restaurante Hymbé) usam o
componente `miniGaleriaHTML`/`ligarMiniGalerias()` em `app.js` — um carrossel
simples sem biblioteca externa, com setas e paginação por toque. Para trocar
as fotos de uma galeria, edite o array de `{src, alt}` passado pra
`miniGaleriaHTML` dentro de `iniciar()`.

## Decisões de projeto que valem conhecer

**A reserva agora é gravada de verdade**, num banco D1 do Cloudflare chamado
`trindade-adventure` (o painel do Cloudflare mostra o nome traduzido de forma
estranha, "aventura-trindade" — é só a tradução automática do próprio painel,
o banco é o mesmo). O site mostra vaga real por horário, dispara um WhatsApp
com o pedido, e a operação confirma pelo painel ou pela própria conversa.

**Isso continua funcionando mesmo se o backend cair.** Cada chamada de
`app.js` para `/api/*` tem um limite de tempo e, se falhar por qualquer
motivo — banco fora do ar, erro no `_worker.js`, engano na configuração —
o site volta sozinho ao comportamento antigo: sem número de vaga, reserva só
por WhatsApp, sem gravar nada. Teste isso antes de mexer no `_worker.js`:
suba uma versão local sem banco e confira que a reserva ainda sai.

**O conteúdo está em HTML, não em JavaScript.** É o que permite ao Google
indexar os roteiros e ao WhatsApp montar a pré-visualização do link. Um site
que se desenha por JavaScript aparece vazio para os dois.

**Tempo e mar são reais.** Vêm da Open-Meteo (licença CC BY 4.0 — a menção no
rodapé é obrigatória, não remova), com cache de 15 minutos no navegador do
visitante. Se o serviço cair, a barra mostra o aviso e o resto da página segue
funcionando.

**Layouts de duas colunas precisam de duas coisas no celular, não só uma.**
Um `grid-template-columns` sem `@media` vira colunas espremidas no celular —
por isso existe a classe `.col-duas` (empilha em telas ≤760px). Mas isso
sozinho não basta quando alguma coluna tem, lá dentro, um `<fieldset>` com
conteúdo largo (por exemplo a lista de datas com rolagem horizontal, em
`#/reservar`): navegadores dão `min-width: min-content` de fábrica pro
`fieldset`, então ele cresce pra caber o filho mais largo e empurra a página
inteira pro lado, ignorando a largura do pai — mesmo com o grid já
empilhado. A correção geral está em `estilo.css`, perto do topo:
`fieldset{min-width:0}`. Se um dia o problema voltar (elemento largo demais
"vazando" pra fora da tela no celular), o primeiro suspeito é um `fieldset`
ou outro elemento com essa mesma folga de tamanho mínimo automático.

## Domínio oficial e e-mails

O endereço canônico é **`https://trindadeadventury.com.br`** (apex, sem `www`; a grafia
"adventury" está correta). Canonical, `og:url`, `og:image`, JSON-LD, `sitemap.xml` e
`robots.txt` apontam para ele (a origem fica em `site-config.origem`).
**Publique este commit só depois de o domínio estar ativo** — senão canonical e sitemap
apontam para um endereço que ainda não resolve.

E-mails publicados: `contato@trindadeadventury.com.br` (rodapé, `/contato`, JSON-LD) e
`suporte@trindadeadventury.com.br` (Política de Privacidade e Termos §12). Crie as caixas
(Email Routing/MX) **antes** de publicar.

Cada rota também sai com JSON-LD próprio, montado pelo `_worker.js`: `BreadcrumbList` nas
rotas internas e `TouristTrip` + `Offer` (preço da tabela `PLANOS`, BRL, `InStock`) em
Essencial, Adventure e Boat. Passeios sob consulta e a pescaria não têm `Offer` (a pescaria
ainda não tem a unidade do preço decidida). `og:image:width/height` vêm de
`site-config.imagensDim` — ao trocar a imagem de uma página, atualize a medida ali.

## Painel: checagem dupla (Access + JWT)

O Cloudflare Access continua na frente de `/admin` e `/api/admin/*`. Além dele, o próprio worker
exige o JWT que o Access injeta (`Cf-Access-Jwt-Assertion`), com a variável `ACCESS_AUD` (tabela
acima). Assim, se alguém mexer na política do Access, ou se um endereço de preview não estiver
coberto por ele, o painel continua fechado (403). O header de e-mail do Access, sozinho, não vale mais.
As respostas do painel saem com `X-Robots-Tag: noindex, nofollow` e `Cache-Control: private, no-store`,
e POST/PATCH/DELETE exigem `Origin` do próprio site e corpo JSON. Os certificados do Access são buscados em
`https://cold-smoke-c7c6.cloudflareaccess.com/cdn-cgi/access/certs` e ficam 1 hora em cache.

**O que conferir no Zero Trust (é seu, o código não mexe nisso):** o aplicativo do Access deve cobrir
`trindade-adventure.pages.dev/admin*` e `/api/admin*`, `*.trindade-adventure.pages.dev/admin*` e
`/api/admin*` (previews por hash e branch), `trindadeadventury.com.br/admin*` e `/api/admin*`, e
`www.trindadeadventury.com.br/admin*`. Não desligue o Access.

Para testar localmente sem o Access: `testes/wrangler.toml` já traz um `ACCESS_AUD` de teste e
`ACCESS_CERTS_URL` apontando para um servidor de certificados de teste que o `testar-api.mjs` sobe na porta 8791
(`ACCESS_CERTS_URL` não existe em produção). `ADMIN_KEY` é só para desenvolvimento: **deixe sem valor em produção**.

## Notas que ficavam como comentário no HTML

Os comentários do `index.html` continuam no código-fonte, mas o `_worker.js` os tira da página
que o visitante recebe (para não expor a arquitetura). O que eles explicavam, em resumo:

- **Turnstile:** o `<meta name="turnstile-sitekey">` traz a chave de teste da Cloudflare; em produção o
  worker a troca por `env.TURNSTILE_SITEKEY`.
- **Pré-visualização (WhatsApp, Instagram, Facebook):** as tags `og:*`/`twitter:*` do `<head>` são as da página
  inicial; para cada endereço o worker troca título, descrição, imagem e canonical a partir da tabela
  `site-config`.
- **Tabela `site-config`:** fonte única das páginas (`secao`, `foco`, `imagem`, `indexar:false`) e dos dados da
  empresa (`negocio`). O worker e o `app.js` leem o mesmo bloco.
- **Página "não encontrada":** o worker entrega a seção `#nao-encontrada` com status 404 e sem `hidden`; o
  `app.js` mostra a mesma seção para links antigos (`#/…`) que apontam para página que não existe mais.
- **Política de Privacidade:** descreve só o que o site faz (reserva gravada no banco D1 da Cloudflare, eventos de
  funil próprios em `/api/eventos`, `localStorage`, sem cookies e sem analytics/pixel de terceiros). Se algo disso
  mudar, atualize o texto.
- **Termos do Passeio:** só regras que o site já informa em outros pontos; nada de multa, taxa ou prazo novo.
- **Dados da empresa no rodapé:** preenchidos pelo servidor a partir de `negocio` (campo vazio não aparece).
- **Leaflet** vem do próprio site e só carrega quando o mapa se aproxima da tela; se faltar, o `app.js` mostra a
  lista de pontos.

Código do pedido: quando o servidor responde, o código vem dele (formato `TA-XXXX-XXXX`). Se não responder, o
`app.js` gera um provisório `TA-DDHHMM-XXXX` (4 caracteres aleatórios), que só serve para cliente e equipe
citarem o mesmo pedido no WhatsApp.

## Checklist antes de publicar (o que fica fora do repositório)

1. **Variáveis do projeto** (Produção **e** Preview): `ORIGENS_PERMITIDAS`, `TURNSTILE_SITEKEY`,
   `TURNSTILE_SECRET` (secret), `ACCESS_AUD`, e — só depois do domínio no ar — `REDIRECIONAR_PARA_DOMINIO=1`.
   `ADMIN_KEY` fica **sem valor**. Opcional: `TURNSTILE_HOSTNAMES`.
2. **Zero Trust:** conferir a cobertura do aplicativo do Access (lista na seção "Painel: checagem dupla").
3. **Banco D1:** `migracoes/0001_rate_limit.sql` e `0002_pendente_e_idempotencia.sql` são opcionais (o worker
   cria/ajusta as tabelas e colunas sozinho). No painel, em **Ajustes**, confira se o campo Instagram não guarda a
   conta antiga (o correto é `trindadeadventure`).
4. **Domínio:** nameservers no Registro.br, zona ativa, custom domains `trindadeadventury.com.br` e `www`,
   "Always Use HTTPS", caixas `contato@` e `suporte@`; depois, ligar `REDIRECIONAR_PARA_DOMINIO`.
5. **Google Search Console:** propriedade `https://trindadeadventury.com.br` + `sitemap.xml`.
6. **Cloudflare WAF:** regra de rate limit extra para `/api/reservas` (defesa além da do worker); rever o HSTS
   (`max-age=31536000; includeSubDomains`, sem `preload`) antes de qualquer `preload`.
7. **Observar a CSP:** deixar a Report-Only rodando ~7 dias em produção (logs `[csp]`) antes de trocar para
   "valendo" (Etapa 25 do plano — ainda não feita).
8. **Decisões de texto ainda abertas** (nada foi escrito sobre elas): unidade do preço, duração, capacidade e
   incluso da pescaria; número de paradas do Adventure; água inclusa x levar; desconto das pousadas na home;
   "Hymbé Vila" x "Hymbé, na praia"; destino da página `/cameras`; dados dos passeios sob consulta; CEP para o JSON-LD; fotos em paisagem
   (1200×630) para a pré-visualização de `/passeios/boat` e `/pousadas`.
