/**
 * Girassol Inteligência — Worker do site
 *
 * Os arquivos estáticos são servidos pelo binding ASSETS. Este Worker só
 * responde às rotas listadas em "run_worker_first" (wrangler.jsonc):
 *
 *   GET  /site-config.json     configuração publicada (D1), com o arquivo estático como reserva
 *   POST /api/evento           métrica anônima (sem cookies, sem dado pessoal)
 *   POST /api/lead             lead gerado quando o visitante envia o resumo à equipe
 *   POST /api/exclusao         pedido de exclusão de dados (LGPD, art. 18)
 *   GET  /casos/<id>           página de um caso, montada no servidor
 *   GET  /sitemap.xml          sitemap com as páginas fixas e cada caso publicado
 *   Cron (dia 1, 08h de Brasília): relatório do mês anterior
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
const STATUS_EXCLUSAO = new Set(["recebido", "em_andamento", "concluido"]);
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
      if (pathname === "/api/exclusao" && request.method === "POST") {
        return registrarExclusao(request, env);
      }
      const caso = pathname.match(/^\/casos\/([a-z0-9-]+)\/?$/);
      if (caso && request.method === "GET") {
        return paginaCaso(request, env, url, caso[1]);
      }
      if (pathname === "/sitemap.xml") return sitemap(env, url);
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

  // Relatório mensal automático (ver "triggers" em wrangler.jsonc)
  async scheduled(evento, env, ctx) {
    ctx.waitUntil(gerarRelatorio(env, mesAnterior()));
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
  const salva = await lerConfig(env).catch((e) => (console.error(e), null));
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

async function registrarExclusao(request, env) {
  const c = await lerCorpo(request, 2000);
  const nome = c && texto(c.nome, 120);
  const email = c && texto(c.email, 160);
  if (!nome || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, erro: "Informe nome e e-mail válidos." }, 400);
  }
  await env.DB.prepare(
    "INSERT INTO pedidos_exclusao (nome, email, telefone) VALUES (?, ?, ?)",
  )
    .bind(nome, email.toLowerCase(), texto(c.telefone, 40))
    .run();
  return json({ ok: true });
}

/* ------------------------------------------------------------------ */
/* Relatório mensal                                                    */
/* ------------------------------------------------------------------ */

function mesAnterior(base = new Date()) {
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
}

async function gerarRelatorio(env, mes) {
  if (!/^\d{4}-\d{2}$/.test(mes)) throw new Error("mês inválido");
  const [a, m] = mes.split("-").map(Number);
  const ini = mes + "-01";
  const fim = new Date(Date.UTC(a, m, 1)).toISOString().slice(0, 10);
  const faixa = "criado_em >= ? AND criado_em < ?";
  const q = (sql) =>
    env.DB.prepare(sql)
      .bind(ini, fim)
      .all()
      .then((r) => r.results);
  const [
    porTipo,
    porAssunto,
    porOrigem,
    porPagina,
    porDispositivo,
    leadsPorStatus,
    leadsPorAssunto,
    exclusoes,
  ] = await Promise.all([
    q(`SELECT tipo, COUNT(*) total FROM eventos WHERE ${faixa} GROUP BY tipo`),
    q(
      `SELECT COALESCE(assunto,'—') assunto, SUM(tipo='cta') cliques, SUM(tipo='chat_aberto') conversas, SUM(tipo='passagem_whatsapp') leads FROM eventos WHERE ${faixa} AND tipo IN ('cta','chat_aberto','passagem_whatsapp') GROUP BY assunto ORDER BY cliques DESC`,
    ),
    q(
      `SELECT COALESCE(origem,'acesso direto') origem, COUNT(*) total FROM eventos WHERE tipo='visita' AND ${faixa} GROUP BY origem ORDER BY total DESC LIMIT 10`,
    ),
    q(
      `SELECT COALESCE(pagina,'—') pagina, COUNT(*) total FROM eventos WHERE tipo='visita' AND ${faixa} GROUP BY pagina ORDER BY total DESC LIMIT 10`,
    ),
    q(
      `SELECT dispositivo, COUNT(*) total FROM eventos WHERE tipo='visita' AND ${faixa} GROUP BY dispositivo`,
    ),
    q(
      `SELECT status, COUNT(*) total FROM leads WHERE ${faixa} GROUP BY status`,
    ),
    q(
      `SELECT COALESCE(assunto,'—') assunto, COUNT(*) total FROM leads WHERE ${faixa} GROUP BY assunto ORDER BY total DESC`,
    ),
    q(
      `SELECT status, COUNT(*) total FROM pedidos_exclusao WHERE ${faixa} GROUP BY status`,
    ),
  ]);
  const dados = {
    mes,
    porTipo,
    porAssunto,
    porOrigem,
    porPagina,
    porDispositivo,
    leadsPorStatus,
    leadsPorAssunto,
    exclusoes,
  };
  await env.DB.prepare(
    "INSERT INTO relatorios (mes, dados, gerado_em) VALUES (?, ?, datetime('now')) " +
      "ON CONFLICT(mes) DO UPDATE SET dados = excluded.dados, gerado_em = excluded.gerado_em",
  )
    .bind(mes, JSON.stringify(dados))
    .run();
  return dados;
}

/* ------------------------------------------------------------------ */
/* Páginas de caso (/casos/<id>) e sitemap gerados no servidor         */
/* WhatsApp, LinkedIn e buscadores não executam JavaScript: o título,  */
/* a descrição e o texto do caso já saem prontos no HTML.              */
/* ------------------------------------------------------------------ */

const SITE = "https://girassolinteligencia.com.br";

async function configAtual(env, url) {
  // Páginas públicas não podem cair se o banco falhar: usa o arquivo do projeto como reserva
  const salva = await lerConfig(env).catch((e) => (console.error(e), null));
  if (salva) return salva.dados;
  const r = await env.ASSETS.fetch(
    new Request(new URL("/site-config.json", url)),
  );
  return r.json();
}

const escHtml = (t) =>
  String(t ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

// Mesmo Markdown simples da home: "### Título" e **destaque**
function markdown(t) {
  return escHtml(t)
    .split(/\n{2,}/)
    .map((bloco) =>
      bloco
        .split("\n")
        .map((l) =>
          l.startsWith("### ")
            ? "<h2>" + l.slice(4) + "</h2>"
            : l
              ? "<p>" + l + "</p>"
              : "",
        )
        .join(""),
    )
    .join("")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

async function paginaCaso(request, env, url, id) {
  const cfg = await configAtual(env, url);
  const caso = (cfg.cases || []).find(
    (c) => c.id === id && c.published !== false,
  );
  const base = await env.ASSETS.fetch(new Request(new URL("/casos", url)));
  if (!caso) {
    return new Response(await base.text(), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  const titulo = `${caso.title} — Casos — Girassol Inteligência`;
  const descricao = caso.summary || "";
  const endereco = `${SITE}/casos/${caso.id}`;
  const data = caso.date
    ? new Date(caso.date + "T12:00:00Z").toLocaleDateString("pt-BR", {
        month: "long",
        year: "numeric",
      })
    : "";
  const meta = (valor) => ({
    element: (el) => el.setAttribute("content", valor),
  });
  const pagina = new HTMLRewriter()
    .on("title", { element: (el) => el.setInnerContent(titulo) })
    .on('meta[name="description"]', meta(descricao))
    .on('meta[property="og:title"]', meta(caso.title))
    .on('meta[property="og:description"]', meta(descricao))
    .on('meta[property="og:url"]', meta(endereco))
    .on('link[rel="canonical"]', {
      element: (el) => el.setAttribute("href", endereco),
    })
    .on("#casoLista", { element: (el) => el.setAttribute("hidden", "") })
    .on("#casoDetalhe", {
      element: (el) => {
        el.removeAttribute("hidden");
        el.setAttribute("data-caso", caso.id);
      },
    })
    .on("#casoCategoria", {
      element: (el) => el.setInnerContent(caso.category || "Caso"),
    })
    .on("#casoTitulo", { element: (el) => el.setInnerContent(caso.title) })
    .on("#casoMeta", {
      element: (el) =>
        el.setInnerContent(
          [data, caso.readTime && caso.readTime + " de leitura"]
            .filter(Boolean)
            .join(" · "),
        ),
    })
    .on("#casoResumo", { element: (el) => el.setInnerContent(descricao) })
    .on("#casoConteudo", {
      element: (el) =>
        el.setInnerContent(markdown(caso.content || ""), { html: true }),
    })
    .transform(base);
  const h = new Headers(pagina.headers);
  h.set("Cache-Control", "public, max-age=60");
  return new Response(pagina.body, { status: 200, headers: h });
}

async function sitemap(env, url) {
  const cfg = await configAtual(env, url);
  const hoje = new Date().toISOString().slice(0, 10);
  const fixas = [
    "/",
    "/solucoes",
    "/casos",
    "/artigos",
    "/privacidade",
    "/termos",
    "/exclusao-dados",
  ];
  const casos = (cfg.cases || [])
    .filter((c) => c.published !== false)
    .map((c) => [`/casos/${c.id}`, c.date]);
  const itens = fixas.map((p) => [p, hoje]).concat(casos);
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    itens
      .map(
        ([p, d]) =>
          `  <url><loc>${SITE}${p}</loc>${d ? `<lastmod>${d}</lastmod>` : ""}</url>`,
      )
      .join("\n") +
    "\n</urlset>\n";
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
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

  if (rota === "exclusoes" && m === "GET") {
    // dias_restantes: prazo de 15 dias informado na página de Exclusão de Dados
    const { results } = await env.DB.prepare(
      "SELECT id, criado_em, nome, email, telefone, status, nota, concluido_em, " +
        "CAST(ROUND(julianday(datetime(criado_em, '+15 days')) - julianday('now')) AS INTEGER) dias_restantes " +
        "FROM pedidos_exclusao ORDER BY (status = 'concluido'), id DESC LIMIT 500",
    ).all();
    return json(results);
  }

  const exc = rota.match(/^exclusoes\/(\d+)$/);
  if (exc && m === "PATCH") {
    const c = await lerCorpo(request, 4000);
    if (!c || (c.status && !STATUS_EXCLUSAO.has(c.status)))
      return json({ erro: "dados inválidos" }, 400);
    await env.DB.prepare(
      "UPDATE pedidos_exclusao SET status = COALESCE(?, status), nota = COALESCE(?, nota), " +
        "concluido_em = CASE WHEN ? = 'concluido' THEN datetime('now') ELSE concluido_em END WHERE id = ?",
    )
      .bind(
        c.status || null,
        texto(c.nota, 2000),
        c.status || null,
        Number(exc[1]),
      )
      .run();
    return json({ ok: true });
  }

  // Leads que mencionam o e-mail, o nome ou o telefone do titular, para excluir antes de concluir o pedido
  const busca = rota.match(/^exclusoes\/(\d+)\/leads$/);
  if (busca && m === "GET") {
    const p = await env.DB.prepare(
      "SELECT nome, email, telefone FROM pedidos_exclusao WHERE id = ?",
    )
      .bind(Number(busca[1]))
      .first();
    if (!p) return json({ erro: "pedido não encontrado" }, 404);
    const digitos = (p.telefone || "").replace(/\D/g, "");
    const termos = [
      p.email,
      p.nome,
      digitos.length >= 8 ? digitos.slice(-8) : null,
    ].filter(Boolean);
    const normalizado =
      "REPLACE(REPLACE(REPLACE(REPLACE(LOWER(resumo),'-',''),' ',''),'.',''),'(','')";
    const cond = termos.map(() => normalizado + " LIKE ?").join(" OR ");
    const valores = termos.map(
      (t) => "%" + t.toLowerCase().replace(/[-\s.(]/g, "") + "%",
    );
    const { results } = await env.DB.prepare(
      `SELECT id, criado_em, assunto, resumo FROM leads WHERE ${cond}`,
    )
      .bind(...valores)
      .all();
    return json(results);
  }

  if (rota === "relatorios" && m === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT mes, gerado_em FROM relatorios ORDER BY mes DESC LIMIT 36",
    ).all();
    return json(results);
  }
  if (rota === "relatorios" && m === "POST") {
    const c = await lerCorpo(request, 200);
    return json(await gerarRelatorio(env, (c && c.mes) || mesAnterior()));
  }
  const rel = rota.match(/^relatorios\/(\d{4}-\d{2})$/);
  if (rel && m === "GET") {
    const linha = await env.DB.prepare(
      "SELECT dados, gerado_em FROM relatorios WHERE mes = ?",
    )
      .bind(rel[1])
      .first();
    return linha
      ? json({ ...JSON.parse(linha.dados), geradoEm: linha.gerado_em })
      : json({ erro: "relatório não encontrado" }, 404);
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
