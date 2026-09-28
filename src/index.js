/**
 * Girassol Inteligência — Worker do site
 *
 * Os arquivos estáticos são servidos pelo binding ASSETS. Este Worker só
 * responde às rotas listadas em "run_worker_first" (wrangler.jsonc):
 *
 *   GET  /site-config.json     configuração publicada (D1), com o arquivo estático como reserva
 *   POST /api/evento           métrica anônima (sem cookies, sem dado pessoal)
 *   POST /api/lead             lead gerado quando o visitante envia o resumo à equipe
 *   /admin.html e /api/admin/* exigem login do Cloudflare Access (JWT verificado aqui)
 */

const TIPOS_EVENTO = new Set([
  "visita",
  "cta",
  "chat_aberto",
  "chat_mensagem",
  "passagem_exibida",
  "passagem_whatsapp",
  "whatsapp_direto",
  "flor_completa",
  "demo",
]);
const STATUS_LEAD = new Set([
  "novo",
  "em_contato",
  "proposta",
  "fechado",
  "descartado",
]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === "/site-config.json" && request.method === "GET") {
        return configPublica(request, env);
      }
      if (pathname === "/api/evento" && request.method === "POST") {
        return registrarEvento(request, env);
      }
      if (pathname === "/api/lead" && request.method === "POST") {
        return registrarLead(request, env);
      }
      if (
        pathname === "/admin.html" ||
        pathname === "/admin" ||
        pathname.startsWith("/api/admin/")
      ) {
        const usuario = await autenticarAdmin(request, env);
        if (!usuario) {
          return pathname.startsWith("/api/")
            ? json({ erro: "não autorizado" }, 401)
            : new Response("Acesso restrito.", { status: 403 });
        }
        if (pathname.startsWith("/api/admin/"))
          return apiAdmin(request, env, url, usuario);
        return env.ASSETS.fetch(request);
      }
      if (pathname.startsWith("/api/"))
        return json({ erro: "rota inexistente" }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error(e);
      return json({ erro: "falha interna" }, 500);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Configuração do site                                                */
/* ------------------------------------------------------------------ */

async function lerConfig(env) {
  const linha = await env.DB.prepare(
    "SELECT dados, atualizado_em, atualizado_por FROM config WHERE id = 1",
  ).first();
  return linha
    ? {
        dados: JSON.parse(linha.dados),
        atualizadoEm: linha.atualizado_em,
        atualizadoPor: linha.atualizado_por,
      }
    : null;
}

async function configPublica(request, env) {
  const salva = await lerConfig(env);
  if (!salva) return env.ASSETS.fetch(request); // ainda não publicada pelo painel: usa o arquivo do projeto
  return json(salva.dados, 200, { "Cache-Control": "public, max-age=60" });
}

/* ------------------------------------------------------------------ */
/* Métricas e leads (rotas públicas)                                   */
/* ------------------------------------------------------------------ */

const texto = (v, max) =>
  typeof v === "string" ? v.trim().slice(0, max) : null;

function dispositivo(request) {
  const ua = request.headers.get("user-agent") || "";
  return /Mobi|Android|iPhone|iPad/i.test(ua) ? "celular" : "computador";
}

async function lerCorpo(request, limite = 8000) {
  const bruto = await request.text();
  if (bruto.length > limite) return null;
  try {
    return JSON.parse(bruto);
  } catch {
    return null;
  }
}

async function registrarEvento(request, env) {
  const c = await lerCorpo(request, 2000);
  if (!c || !TIPOS_EVENTO.has(c.tipo)) return json({ ok: false }, 400);
  // Origem guardada só como domínio (sem caminho nem parâmetros)
  let origem = null;
  try {
    if (c.origem) origem = new URL(c.origem).hostname.slice(0, 120);
  } catch {}
  await env.DB.prepare(
    "INSERT INTO eventos (tipo, assunto, pagina, origem, dispositivo) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(
      c.tipo,
      texto(c.assunto, 40),
      texto(c.pagina, 120),
      origem,
      dispositivo(request),
    )
    .run();
  return json({ ok: true });
}

async function registrarLead(request, env) {
  const c = await lerCorpo(request, 6000);
  const resumo = c && texto(c.resumo, 3000);
  if (!resumo) return json({ ok: false }, 400);
  await env.DB.prepare(
    "INSERT INTO leads (assunto, resumo, pagina, dispositivo) VALUES (?, ?, ?, ?)",
  )
    .bind(
      texto(c.assunto, 40) || "diagnostico",
      resumo,
      texto(c.pagina, 120),
      dispositivo(request),
    )
    .run();
  return json({ ok: true });
}

/* ------------------------------------------------------------------ */
/* Autenticação do painel: JWT do Cloudflare Access                    */
/* ------------------------------------------------------------------ */

let certsCache = { chaves: null, ate: 0 };

async function chavesAccess(env) {
  if (certsCache.chaves && Date.now() < certsCache.ate)
    return certsCache.chaves;
  const r = await fetch(
    `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`,
  );
  const { keys } = await r.json();
  certsCache = { chaves: keys, ate: Date.now() + 60 * 60 * 1000 };
  return keys;
}

const b64url = (s) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );

async function autenticarAdmin(request, env) {
  // Desenvolvimento local (wrangler dev com .dev.vars): nunca definido em produção
  if (
    env.ADMIN_DEV_BYPASS === "1" &&
    new URL(request.url).hostname === "localhost"
  )
    return "dev@local";

  const cookie = request.headers.get("cookie") || "";
  const token =
    request.headers.get("cf-access-jwt-assertion") ||
    (cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/) || [])[1];
  if (!token || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;

  const partes = token.split(".");
  if (partes.length !== 3) return null;
  let cab, carga;
  try {
    cab = JSON.parse(new TextDecoder().decode(b64url(partes[0])));
    carga = JSON.parse(new TextDecoder().decode(b64url(partes[1])));
  } catch {
    return null;
  }
  const jwk = (await chavesAccess(env)).find((k) => k.kid === cab.kid);
  if (!jwk) return null;
  const chave = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valido = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    chave,
    b64url(partes[2]),
    new TextEncoder().encode(`${partes[0]}.${partes[1]}`),
  );
  const agora = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(carga.aud) ? carga.aud : [carga.aud];
  if (!valido || carga.exp < agora || !aud.includes(env.ACCESS_AUD))
    return null;
  if (carga.iss && carga.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`)
    return null;
  return carga.email || "admin";
}

/* ------------------------------------------------------------------ */
/* API do painel                                                       */
/* ------------------------------------------------------------------ */

async function apiAdmin(request, env, url, usuario) {
  const rota = url.pathname.replace("/api/admin/", "");
  const m = request.method;

  if (rota === "eu" && m === "GET") return json({ usuario });

  if (rota === "config" && m === "GET") {
    const salva = await lerConfig(env);
    if (salva) return json(salva);
    const arquivo = await env.ASSETS.fetch(
      new Request(new URL("/site-config.json", url)),
    );
    return json({
      dados: await arquivo.json(),
      atualizadoEm: null,
      atualizadoPor: null,
    });
  }

  if (rota === "config" && m === "PUT") {
    const c = await lerCorpo(request, 500000);
    if (
      !c ||
      typeof c !== "object" ||
      !Array.isArray(c.articles) ||
      !Array.isArray(c.cases)
    ) {
      return json({ erro: "configuração inválida" }, 400);
    }
    delete c.leads; // leads ficam no banco, nunca no arquivo público
    await env.DB.prepare(
      "INSERT INTO config (id, dados, atualizado_em, atualizado_por) VALUES (1, ?, datetime('now'), ?) " +
        "ON CONFLICT(id) DO UPDATE SET dados = excluded.dados, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por",
    )
      .bind(JSON.stringify(c), usuario)
      .run();
    await env.DB.prepare(
      "INSERT INTO config_historico (dados, salvo_por) VALUES (?, ?)",
    )
      .bind(JSON.stringify(c), usuario)
      .run();
    await env.DB.prepare(
      "DELETE FROM config_historico WHERE id NOT IN (SELECT id FROM config_historico ORDER BY id DESC LIMIT 30)",
    ).run();
    return json({ ok: true });
  }

  if (rota === "historico" && m === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, salvo_em, salvo_por FROM config_historico ORDER BY id DESC LIMIT 30",
    ).all();
    return json(results);
  }

  const restaurar = rota.match(/^historico\/(\d+)$/);
  if (restaurar && m === "GET") {
    const linha = await env.DB.prepare(
      "SELECT dados FROM config_historico WHERE id = ?",
    )
      .bind(Number(restaurar[1]))
      .first();
    return linha
      ? json(JSON.parse(linha.dados))
      : json({ erro: "versão não encontrada" }, 404);
  }

  if (rota === "leads" && m === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, criado_em, assunto, resumo, pagina, dispositivo, status, nota, atualizado_em FROM leads ORDER BY id DESC LIMIT 500",
    ).all();
    return json(results);
  }

  const lead = rota.match(/^leads\/(\d+)$/);
  if (lead && m === "PATCH") {
    const c = await lerCorpo(request, 4000);
    if (!c || (c.status && !STATUS_LEAD.has(c.status)))
      return json({ erro: "dados inválidos" }, 400);
    await env.DB.prepare(
      "UPDATE leads SET status = COALESCE(?, status), nota = COALESCE(?, nota), atualizado_em = datetime('now') WHERE id = ?",
    )
      .bind(c.status || null, texto(c.nota, 2000), Number(lead[1]))
      .run();
    return json({ ok: true });
  }
  if (lead && m === "DELETE") {
    await env.DB.prepare("DELETE FROM leads WHERE id = ?")
      .bind(Number(lead[1]))
      .run();
    return json({ ok: true });
  }

  if (rota === "metricas" && m === "GET") {
    const dias = Math.min(
      Math.max(Number(url.searchParams.get("dias")) || 30, 1),
      365,
    );
    const desde = `-${dias} days`;
    const q = (sql) =>
      env.DB.prepare(sql)
        .bind(desde)
        .all()
        .then((r) => r.results);
    const [
      porTipo,
      porDia,
      porAssunto,
      porDispositivo,
      porOrigem,
      porPagina,
      leadsPorStatus,
    ] = await Promise.all([
      q(
        "SELECT tipo, COUNT(*) total FROM eventos WHERE criado_em >= datetime('now', ?) GROUP BY tipo",
      ),
      q(
        "SELECT date(criado_em) dia, SUM(tipo='visita') visitas, SUM(tipo='chat_aberto') conversas, SUM(tipo='passagem_whatsapp') leads FROM eventos WHERE criado_em >= datetime('now', ?) GROUP BY dia ORDER BY dia",
      ),
      q(
        "SELECT COALESCE(assunto,'—') assunto, SUM(tipo='cta') cliques, SUM(tipo='chat_aberto') conversas, SUM(tipo='passagem_whatsapp') leads FROM eventos WHERE criado_em >= datetime('now', ?) AND tipo IN ('cta','chat_aberto','passagem_whatsapp') GROUP BY assunto ORDER BY cliques DESC",
      ),
      q(
        "SELECT dispositivo, COUNT(*) total FROM eventos WHERE tipo='visita' AND criado_em >= datetime('now', ?) GROUP BY dispositivo",
      ),
      q(
        "SELECT COALESCE(origem,'acesso direto') origem, COUNT(*) total FROM eventos WHERE tipo='visita' AND criado_em >= datetime('now', ?) GROUP BY origem ORDER BY total DESC LIMIT 10",
      ),
      q(
        "SELECT COALESCE(pagina,'—') pagina, COUNT(*) total FROM eventos WHERE tipo='visita' AND criado_em >= datetime('now', ?) GROUP BY pagina ORDER BY total DESC LIMIT 10",
      ),
      q(
        "SELECT status, COUNT(*) total FROM leads WHERE criado_em >= datetime('now', ?) GROUP BY status",
      ),
    ]);
    return json({
      dias,
      porTipo,
      porDia,
      porAssunto,
      porDispositivo,
      porOrigem,
      porPagina,
      leadsPorStatus,
    });
  }

  return json({ erro: "rota inexistente" }, 404);
}

/* ------------------------------------------------------------------ */

function json(dados, status = 200, extra = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}
