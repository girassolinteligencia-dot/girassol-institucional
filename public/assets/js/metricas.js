/* Girassol Inteligência — métricas anônimas do site.
   Sem cookies e sem identificação do visitante: só contagens por tipo de evento.
   Os eventos alimentam o painel (aba Métricas). Os leads só são gravados quando
   o visitante toca em "Enviar resumo à equipe pelo WhatsApp". */
(function () {
  if (location.protocol === "file:") return;

  function enviar(rota, dados) {
    const corpo = JSON.stringify(dados);
    try {
      if (
        navigator.sendBeacon &&
        navigator.sendBeacon(
          rota,
          new Blob([corpo], { type: "application/json" }),
        )
      )
        return;
    } catch (e) {}
    fetch(rota, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corpo,
      keepalive: true,
    }).catch(() => {});
  }

  function metrica(tipo, extra) {
    enviar(
      "/api/evento",
      Object.assign({ tipo: tipo, pagina: location.pathname }, extra || {}),
    );
  }
  window.girassolMetrica = metrica;

  // Visita (a origem só é enviada quando vem de outro site)
  const ref =
    document.referrer &&
    new URL(document.referrer).hostname !== location.hostname
      ? document.referrer
      : null;
  metrica("visita", { origem: ref });

  // Cliques: botões do chat, WhatsApp direto e demonstrações
  document.addEventListener(
    "click",
    function (e) {
      const el = e.target.closest("a, button");
      if (!el) return;
      if (el.classList.contains("js-chat"))
        metrica("cta", { assunto: el.dataset.assunto || "diagnostico" });
      else if (el.dataset.evento === "demo")
        metrica("demo", { assunto: el.dataset.assunto || null });
      else if (
        /wa\.me\//.test(el.getAttribute("href") || "") &&
        !el.closest(".chat-handoff")
      )
        metrica("whatsapp_direto");
    },
    true,
  );

  // Eventos do chat (disparados por chat-widget.js) e da home
  window.addEventListener("girassol:metrica", function (e) {
    const d = e.detail || {};
    metrica(d.tipo, { assunto: d.assunto || null });
    if (d.tipo === "passagem_whatsapp" && d.resumo) {
      enviar("/api/lead", {
        assunto: d.assunto,
        resumo: d.resumo,
        pagina: location.pathname,
      });
    }
  });
})();
