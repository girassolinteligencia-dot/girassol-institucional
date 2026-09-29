/* Girassol Inteligência — aplica os textos editados no painel (aba "Textos do site")
   aos elementos marcados com data-texto nas páginas internas.
   A home tem a própria rotina (index.html). Campo vazio mantém o texto do HTML. */
(function () {
  fetch("/site-config.json")
    .then((r) => r.json())
    .then((cfg) => {
      const textos = (cfg && cfg.home) || {};
      document.querySelectorAll("[data-texto]").forEach((el) => {
        const v = textos[el.dataset.texto];
        if (typeof v === "string" && v.trim() && v !== el.textContent.trim())
          el.textContent = v;
      });
      window.girassolTextos = textos;
      window.dispatchEvent(
        new CustomEvent("girassol:textos", { detail: textos }),
      );
    })
    .catch(() => {});
})();
