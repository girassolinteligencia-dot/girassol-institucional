/* Girassol Inteligência — seletor de tema claro/escuro.
   Carregar no <head> (sem defer) para evitar piscar o tema errado.
   Padrão por página: <html data-tema-padrao="claro|escuro" data-tema-chave="...">.
   A escolha do visitante fica salva no navegador. */
(function () {
  var d = document.documentElement;
  var chave = d.getAttribute("data-tema-chave") || "girassol-tema";
  var padrao = d.getAttribute("data-tema-padrao") || "claro";
  var salvo = null;
  try {
    salvo = localStorage.getItem(chave);
  } catch (e) {}
  aplicar((salvo || padrao) === "escuro");

  function aplicar(escuro) {
    d.setAttribute("data-theme", escuro ? "dark" : "light");
  }

  document.addEventListener("DOMContentLoaded", function () {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "tema-toggle";
    function rotulo() {
      var escuro = d.getAttribute("data-theme") === "dark";
      b.textContent = escuro ? "[ modo claro ]" : "[ modo escuro ]";
      b.setAttribute("aria-pressed", escuro ? "true" : "false");
      b.setAttribute(
        "aria-label",
        escuro ? "Ativar modo claro" : "Ativar modo escuro",
      );
    }
    b.addEventListener("click", function () {
      var escuro = d.getAttribute("data-theme") !== "dark";
      aplicar(escuro);
      try {
        localStorage.setItem(chave, escuro ? "escuro" : "claro");
      } catch (e) {}
      rotulo();
    });
    rotulo();
    document.body.appendChild(b);
  });
})();
