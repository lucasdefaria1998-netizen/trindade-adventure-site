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
| `app.js` | Comportamento do site público: navegação, tempo e mar ao vivo, montador de reserva, mapa, envio para a API. |
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

**Endereço:** `https://trindade-adventure.pages.dev/admin`

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
`5524993337247` (55 + DDD + número, só dígitos). Troque também o texto visível
em `index.html` (busque por `99333-7247`) e o `telephone` do bloco JSON-LD.

**Horários de saída** — `app.js`, em `CFG.slotInicio` e `CFG.slotFim` (e no
painel, Ajustes). Para um passeio com saída própria, use o campo `horarios` do
plano: `[8.5]` é 08:30.

**Duração e última saída de cada passeio** — cada plano tem `duracaoMin` em
`PLANOS` (no `_worker.js`, que vale, e no `app.js`). Um horário só é
oferecido se o passeio terminar até o **horário-limite de retorno**:

    concentração + saída (20 min) + duração ≤ retorno_limite

O padrão é 18:20 — o retorno da saída mais tarde que o Essencial (≈ 3h) já
tinha às 15:00. Com isso o Adventure (≈ 6h) vai até 12:00 e o Boat segue às
08:30. Para mudar sem publicar: painel → Ajustes → "Retorno até". Não é o pôr
do sol (que muda o ano todo); é um horário fixo da operação. Um plano também
pode ter `ultimaSaida` para cortar a grade num horário específico.

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

## Testar antes de publicar

Com Node instalado, a partir da pasta `testes/` (banco D1 **local**, nada vai
para a produção):

    npx wrangler d1 execute trindade-local --local --file schema-local.sql
    npx wrangler pages dev --port 8788

e, em outro terminal, na pasta do projeto:

    node testes/testar-http.mjs http://127.0.0.1:8788

São ~150 verificações: 404, cache, título/descrição/canonical/OG de cada
página, sitemap, e a regra de horários (inclusive reservas de teste no banco
local). Contra o site no ar (`node testes/testar-http.mjs https://trindade-adventure.pages.dev`)
os testes que gravam reserva são pulados automaticamente.

Outro conjunto, só da API (portão dos POST, limite por IP, validação…), só
localhost — grava no D1 local e confere a contagem de linhas:

    node testes/testar-api.mjs

O teste ponta a ponta da reserva no navegador está em
`testes/e2e-reserva.browser.js` (cole no console de http://127.0.0.1:8788/reservar;
ele troca o `window.open` por um stub e nunca abre o WhatsApp).

### Variáveis do projeto no Cloudflare Pages

| Variável | Para quê | Se faltar |
|---|---|---|
| `ORIGENS_PERMITIDAS` | Origens que podem fazer POST em `/api/reservas` e `/api/eventos`, separadas por vírgula. Aceita `https://*.trindade-adventure.pages.dev` para os endereços de preview. Configure em **Produção** e em **Preview**. | Vale a lista de produção embutida no `_worker.js` (`trindadeadventury.com.br` e `trindade-adventure.pages.dev`): um preview recebe 403 no POST até a variável ser configurada. |
| `TURNSTILE_SITEKEY` | Sitekey **pública** do widget Turnstile (desafio anti-robô da reserva). O `_worker.js` coloca este valor no `<meta name="turnstile-sitekey">`; sem ela vale a chave de teste que vem no `index.html`. Hostnames do widget: `trindadeadventury.com.br`, `www.trindadeadventury.com.br`, `trindade-adventure.pages.dev`. | Widget de teste (sempre "passa"): com o segredo real, toda reserva online é recusada (403) e o site segue pelo WhatsApp. |
| `TURNSTILE_SECRET` | Segredo do Turnstile (**Secret**, nunca no repositório nem no chat). Configure em Produção e em Preview, junto com a sitekey. | **Reserva online fechada** (503): o site cai sozinho no fluxo de WhatsApp, sem gravar no painel. Configure antes de publicar. |
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
3. **Domínio próprio — falta um passo no Registro.br.** O domínio é
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

   Quando a Cloudflare mostrar a zona como **ativa**, faltam dois passos:
   Pages → `trindade-adventure` → Custom domains → adicionar
   `trindadeadventury.com.br`; e trocar as cinco ocorrências de
   `trindade-adventure.pages.dev` em `index.html`, mais `robots.txt` e
   `sitemap.xml`, republicando em seguida — senão a pré-visualização do
   WhatsApp continua apontando para o endereço antigo.

   O pacote `trindade-adventure-site-DOMINIO-PROPRIO.zip`, na pasta Downloads,
   já está com essa troca feita. Depois que a zona ficar ativa, é só publicá-lo
   no lugar do outro.
4. **CNPJ e Cadastur.** O CNPJ 64.565.826/0001-80 está no rodapé e no JSON-LD
   desde 05/10/2026. Faltam o número do **Cadastur** (é um registro próprio do
   Ministério do Turismo, diferente do CNPJ) e, se quiser, a razão social:
   preencha em `negocio`, na tabela `site-config`.

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
