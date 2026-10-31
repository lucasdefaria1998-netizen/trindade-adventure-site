// Selos e aceite dos termos, em 360px e 1280px.
// Precisa do site local: npx wrangler pages dev --port 8788 (pasta testes/).
//   npx --yes playwright test testes/aceite-selos.spec.js
import { test, expect } from "@playwright/test";

const BASE = process.env.BASE || "http://127.0.0.1:8788";
const LARGURAS = [360, 1280];

for (const largura of LARGURAS) {
  test.describe(`${largura}px`, () => {
    test.use({ viewport: { width: largura, height: 800 } });

    test("selos nos cartões e nas páginas, sem snorkel e sem pagamento protegido", async ({ page }) => {
      await page.goto(BASE + "/");
      const home = page.locator("#mais-procurados");
      await expect(home.getByText("Guia local").first()).toBeVisible();
      await expect(home.getByText("Orientações de segurança").first()).toBeVisible();
      await expect(home.getByText("Reserva digital confirmada").first()).toBeVisible();
      await expect(home.getByText("Pagamento protegido")).toHaveCount(0);
      await expect(home.getByText("Equipamento de snorkel incluso")).toHaveCount(0);
      await expect(home.getByText("Guia credenciado")).toHaveCount(0);
      const icone = home.locator(".selos-passeio svg").first();
      await expect(icone).toHaveAttribute("aria-hidden", "true");

      await page.goto(BASE + "/passeios/adventure");
      const painel = page.locator("#roteiro-adventure");
      await expect(painel.getByText("Guia local", { exact: true })).toBeVisible();
      await expect(painel.getByText("Reserva digital confirmada")).toBeVisible();
      await expect(painel.getByText("Pagamento protegido")).toHaveCount(0);
      await expect(painel.getByText("Equipamento de snorkel incluso")).toHaveCount(0);
    });

    test("aceite obrigatório, WhatsApp opcional, modal acessível", async ({ page }) => {
      await page.goto(BASE + "/reservar");
      const termos = page.locator("#fAceiteTermos");
      const whats = page.locator("#fAceiteWhatsapp");
      const enviar = page.locator("#btnEnviarReserva");
      await expect(termos).not.toBeChecked();
      await expect(whats).not.toBeChecked();
      await expect(enviar).toBeDisabled();
      await expect(page.locator("#selosReserva").getByText("Reserva digital confirmada")).toBeVisible();
      await expect(page.locator("#selosReserva").getByText("Pagamento protegido")).toHaveCount(0);
      await expect(page.getByText("Guia credenciado")).toHaveCount(0);

      await page.locator("#abrirTermos").click();
      const modal = page.locator("#modalTermos");
      await expect(modal).toBeVisible();
      await expect(modal).toHaveAttribute("aria-modal", "true");
      await expect(modal.getByText("O cancelamento é gratuito até 12 horas antes da saída.")).toBeVisible();
      await expect(page.locator("#fecharTermos")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(modal).toBeHidden();
      await expect(page.locator("#abrirTermos")).toBeFocused();

      await termos.check();
      await expect(enviar).toBeEnabled();
      await whats.check();
      await expect(enviar).toBeEnabled();
    });
  });
}
