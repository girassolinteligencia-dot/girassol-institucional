#!/usr/bin/env node
/**
 * Configura o login do painel (senha + código de duas etapas).
 *
 * Uso, na raiz do projeto:
 *   node scripts/configurar-acesso.mjs            senha, código e chave de sessão (primeira vez)
 *   node scripts/configurar-acesso.mjs --senha    troca só a senha
 *   node scripts/configurar-acesso.mjs --codigo   cadastra um novo aplicativo autenticador
 *   node scripts/configurar-acesso.mjs --sair     derruba todas as sessões abertas
 *
 * A senha nunca é gravada nem exibida: só o hash (PBKDF2) vai para os segredos da Cloudflare.
 */
import { webcrypto as crypto } from "node:crypto";
import { spawnSync } from "node:child_process";
import readline from "node:readline";

const ITERACOES = 100000; // limite do PBKDF2 nos Workers
const arg = process.argv[2] || "";
const tudo = !["--senha", "--codigo", "--sair"].includes(arg);

function perguntar(texto, oculto = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    if (oculto) {
      rl._writeToOutput = (s) => {
        if (s.includes(texto)) rl.output.write(texto);
        else if (s !== "\r\n" && s !== "\n") rl.output.write("*");
      };
    }
    rl.question(texto, (r) => {
      rl.close();
      if (oculto) process.stdout.write("\n");
      resolve(r.trim());
    });
  });
}

const b64 = (buf) => Buffer.from(buf).toString("base64");

function base32(bytes) {
  const alfa = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  let s = "";
  for (let i = 0; i < bits.length; i += 5)
    s += alfa[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return s;
}

function deBase32(s) {
  const alfa = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of s) bits += alfa.indexOf(c).toString(2).padStart(5, "0");
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    out.push(parseInt(bits.slice(i, i + 8), 2));
  return new Uint8Array(out);
}

async function totp(segredo, contador) {
  const chave = await crypto.subtle.importKey(
    "raw",
    deBase32(segredo),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const msg = new ArrayBuffer(8);
  new DataView(msg).setUint32(4, contador);
  const h = new Uint8Array(await crypto.subtle.sign("HMAC", chave, msg));
  const o = h[h.length - 1] & 15;
  const n =
    ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, "0");
}

function gravarSegredo(nome, valor) {
  const r = spawnSync("npx", ["-y", "wrangler@latest", "secret", "put", nome], {
    input: valor,
    stdio: ["pipe", "inherit", "inherit"],
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    console.error(
      `\nFalha ao gravar ${nome}. Confira se você está logado no Wrangler (npx wrangler login).`,
    );
    process.exit(1);
  }
}

console.log("\nConfiguração do login do painel — Girassol Inteligência\n");

if (tudo || arg === "--senha") {
  const s1 = await perguntar("Nova senha (mínimo 12 caracteres): ", true);
  if (s1.length < 12) {
    console.error("A senha precisa ter pelo menos 12 caracteres.");
    process.exit(1);
  }
  const s2 = await perguntar("Repita a senha: ", true);
  if (s1 !== s2) {
    console.error("As senhas não conferem.");
    process.exit(1);
  }
  const sal = crypto.getRandomValues(new Uint8Array(16));
  const chave = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(s1),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: ITERACOES },
    chave,
    256,
  );
  gravarSegredo(
    "ADMIN_SENHA_HASH",
    `pbkdf2$${ITERACOES}$${b64(sal)}$${b64(bits)}`,
  );
  console.log("Senha gravada.\n");
}

if (tudo || arg === "--codigo") {
  const segredo = base32(crypto.getRandomValues(new Uint8Array(20)));
  const uri = `otpauth://totp/Girassol%20Painel:admin?secret=${segredo}&issuer=Girassol%20Painel&algorithm=SHA1&digits=6&period=30`;
  console.log(
    "Abra o aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password…)",
  );
  console.log(
    "e leia o QR code abaixo. Se não conseguir, digite a chave manualmente:\n",
  );
  spawnSync("npx", ["-y", "qrcode-terminal", `"${uri}"`], {
    stdio: "inherit",
    shell: true,
  });
  console.log(`\nChave manual: ${segredo.match(/.{1,4}/g).join(" ")}\n`);
  const agora = Math.floor(Date.now() / 30000);
  const codigo = await perguntar(
    "Para confirmar, digite o código de 6 dígitos que aparece no aplicativo: ",
  );
  const validos = await Promise.all(
    [agora - 1, agora, agora + 1].map((c) => totp(segredo, c)),
  );
  if (!validos.includes(codigo)) {
    console.error(
      "Código não confere. Nada foi gravado; rode o script de novo.",
    );
    process.exit(1);
  }
  gravarSegredo("ADMIN_TOTP_SEGREDO", segredo);
  console.log("Código de duas etapas gravado.\n");
}

if (tudo || arg === "--sair") {
  gravarSegredo(
    "SESSAO_CHAVE",
    b64(crypto.getRandomValues(new Uint8Array(32))),
  );
  console.log(
    arg === "--sair"
      ? "Todas as sessões foram encerradas.\n"
      : "Chave de sessão gravada.\n",
  );
}

console.log("Pronto. Entre em https://girassolinteligencia.com.br/admin.html");
