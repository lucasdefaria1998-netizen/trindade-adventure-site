# www.trindadeadventury.com.br → trindadeadventury.com.br (301)

Auditoria de 16/11, P2. O endereço oficial é **sem www**: `https://trindadeadventury.com.br`.
O canonical, o `og:url`, o sitemap e o JSON-LD já usam só esse endereço (o `_worker.js` monta tudo a
partir de `origem` no site-config, e o `testar-http.mjs` confere que nenhum deles traz `www.`).

## Como está hoje (16/11/2026)

- `trindadeadventury.com.br` está no Cloudflare (servidores `apollo` e `leia.ns.cloudflare.com`) e
  responde pelo Pages.
- `www.trindadeadventury.com.br` **não tem registro DNS**: quem digita com www não abre nada.

## O que fazer no painel do Cloudflare (Lucas)

Nada disso mexe no deploy nem no código; pode ser feito a qualquer momento.

1. **DNS → Records → Add record**
   - Type: `CNAME`
   - Name: `www`
   - Target: `trindadeadventury.com.br`
   - Proxy status: **Proxied** (nuvem laranja). Sem o proxy, a regra do passo 2 não roda.
   - TTL: Auto

2. **Rules → Redirect Rules → Create rule** (modelo "Redirect from WWW to root", ou à mão):
   - Nome: `www para o domínio oficial`
   - Quando: *Wildcard pattern*, Request URL `https://www.trindadeadventury.com.br/*`
   - Então: Target URL `https://trindadeadventury.com.br/${1}`
   - Status code: **301**
   - **Preserve query string**: ligado
   - Deploy.

   Equivalente em expressão (editor "Custom filter expression"), se preferir:
   - Quando: `(http.host eq "www.trindadeadventury.com.br")`
   - URL de destino *Dynamic*: `concat("https://trindadeadventury.com.br", http.request.uri.path)`,
     status 301, preserve query string ligado.

3. O certificado do www sai sozinho (o Universal SSL cobre `trindadeadventury.com.br` e
   `*.trindadeadventury.com.br`). Pode levar alguns minutos depois do passo 1.

Não é preciso adicionar o www como domínio personalizado no Pages: o redirect acontece na borda do
Cloudflare, antes de chegar ao site.

## Como conferir

```sh
# esperado: 301 e Location com o mesmo caminho e a mesma query, sem www
curl -sI "https://www.trindadeadventury.com.br/passeios/essencial?utm_source=teste" | grep -iE "^(HTTP|location)"
curl -sI "http://www.trindadeadventury.com.br/" | grep -iE "^(HTTP|location)"
# esperado: 200, e o canonical sem www
curl -s https://trindadeadventury.com.br/passeios/essencial | grep -o '<link rel="canonical"[^>]*>'
```

## E o redirect que já existe no `_worker.js`?

`destinoRedirect()` também manda `www.trindadeadventury.com.br` (e `trindade-adventure.pages.dev`) para
o domínio oficial, mas só quando a variável `REDIRECIONAR_PARA_DOMINIO="1"` está ligada no Pages **e** o
pedido chega ao site. Com o www só no DNS (passo 1, sem o domínio no Pages), o pedido não chega ao
worker; por isso a regra do passo 2 é a que vale. As duas juntas não fazem loop: o destino é sempre o
endereço sem www.
