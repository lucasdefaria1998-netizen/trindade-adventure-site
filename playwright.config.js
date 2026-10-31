import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "testes",
  testMatch: "aceite-selos.spec.js",
  timeout: 30000,
  use: { baseURL: process.env.BASE || "http://127.0.0.1:8788" },
  reporter: "line"
});
