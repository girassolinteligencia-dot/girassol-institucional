/**
 * ==========================================================================
 * GIRASSOL INTELIGÊNCIA - CLIENTE DE CHAT WEB INSTITUCIONAL
 * Conexão direta com api.girassolinteligencia.com.br (Canal: "web")
 * Integração com Cloudflare Turnstile Anti-bot
 * ==========================================================================
 */

(function () {
  const STORAGE_KEY = "girassol_web_session";
  const DEFAULT_API_BASE = "https://api.girassolinteligencia.com.br";
  const TURNSTILE_SITE_KEY = "0x4AAAAAAEw5N47esEJTOqpj";
  const WHATSAPP_LINK = "https://wa.me/5567999818818?text=Ol%C3%A1%2C+estou+no+site+da+Girassol+e+gostaria+de+continuar+meu+atendimento.";

  class GirassolChatWidget {
    constructor() {
      this.apiBase = window.GIRASSOL_API_URL || DEFAULT_API_BASE;
      this.sessionId = null;
      this.isOpen = false;
      this.isLoading = false;
      this.messages = [];
      this.turnstileWidgetId = null;
      this.turnstileToken = null;
      this.init();
    }

    async init() {
      this.restoreSession();
      this.createDOM();
      this.attachEvents();
      this.initTurnstile();

      // Mensagem de boas-vindas inicial se não houver histórico
      if (this.messages.length === 0) {
        this.addMessage(
          "assistant",
          "Olá! Seja bem-vindo à Girassol Inteligência. Sou o Assessor Direto do nosso Núcleo de IA. Como posso ajudar você a transformar a operação da sua empresa com agentes cognitivos autônomos hoje?"
        );
      }
    }

    initTurnstile() {
      const checkTurnstile = setInterval(() => {
        if (window.turnstile && document.getElementById("girassolTurnstileContainer")) {
          clearInterval(checkTurnstile);
          try {
            this.turnstileWidgetId = window.turnstile.render(
              "#girassolTurnstileContainer",
              {
                sitekey: TURNSTILE_SITE_KEY,
                callback: (token) => {
                  this.turnstileToken = token;
                },
                "expired-callback": () => {
                  this.turnstileToken = null;
                  if (this.turnstileWidgetId) window.turnstile.reset(this.turnstileWidgetId);
                },
                "error-callback": () => {
                  console.warn("[Turnstile] Verificação local ignorada em modo de teste.");
                },
                theme: "dark",
                size: "invisible",
              }
            );
          } catch (e) {
            console.warn("[Turnstile] Render error:", e);
          }
        }
      }, 300);

      setTimeout(() => clearInterval(checkTurnstile), 10000);
    }

    restoreSession() {
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          this.sessionId = parsed.sessionId;
          this.messages = parsed.messages || [];
        }
      } catch (e) {
        console.warn("[GirassolChat] Falha ao restaurar sessão:", e);
      }
    }

    saveSession() {
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            sessionId: this.sessionId,
            messages: this.messages,
          })
        );
      } catch (e) {
        console.warn("[GirassolChat] Falha ao salvar sessão:", e);
      }
    }

    createDOM() {
      // 1. Botão Flutuante (Trigger)
      const launcher = document.createElement("button");
      launcher.className = "girassol-chat-launcher";
      launcher.id = "girassolChatLauncher";
      launcher.setAttribute("aria-label", "Abrir chat com a IA da Girassol");
      launcher.innerHTML = `
        <div class="launcher-icon-wrap">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          <span class="launcher-pulse"></span>
        </div>
        <span class="launcher-label">Falar com a IA</span>
      `;
      document.body.appendChild(launcher);
      this.launcherEl = launcher;

      // 2. Janela de Chat Flutuante
      const chatWindow = document.createElement("div");
      chatWindow.className = "girassol-chat-window";
      chatWindow.id = "girassolChatWindow";
      chatWindow.innerHTML = `
        <div class="chat-header">
          <div class="chat-agent-info">
            <div class="chat-agent-avatar">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="5"></circle>
                <line x1="12" y1="1" x2="12" y2="3"></line>
                <line x1="12" y1="21" x2="12" y2="23"></line>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
                <line x1="1" y1="12" x2="3" y2="12"></line>
                <line x1="21" y1="12" x2="23" y2="12"></line>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
              </svg>
              <span class="agent-status-dot"></span>
            </div>
            <div class="agent-titles">
              <span class="agent-name">Assessor Girassol</span>
              <span class="agent-badge">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
                Núcleo de IA Conectado
              </span>
            </div>
          </div>
          <div class="chat-controls">
            <button class="chat-btn-icon" id="girassolChatMinimize" title="Minimizar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            </button>
          </div>
        </div>

        <div class="chat-messages" id="girassolChatMessages"></div>

        <div class="chat-typing" id="girassolChatTyping">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </div>

        <div class="chat-footer">
          <!-- Container invisível do Turnstile -->
          <div id="girassolTurnstileContainer" style="display:none;"></div>

          <form class="chat-form" id="girassolChatForm">
            <input 
              type="text" 
              class="chat-input" 
              id="girassolChatInput" 
              placeholder="Digite sua dúvida sobre nossos agentes..." 
              autocomplete="off" 
              maxlength="1000"
            />
            <button type="submit" class="chat-send-btn" id="girassolChatSend" aria-label="Enviar mensagem">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </form>
          <div class="chat-powered-by">
            <span>Powered by Girassol Multi-Agent Core • Protegido por Cloudflare</span>
          </div>
        </div>
      `;
      document.body.appendChild(chatWindow);
      this.windowEl = chatWindow;
      this.messagesContainer = chatWindow.querySelector("#girassolChatMessages");
      this.typingIndicator = chatWindow.querySelector("#girassolChatTyping");
      this.inputEl = chatWindow.querySelector("#girassolChatInput");
      this.formEl = chatWindow.querySelector("#girassolChatForm");

      // Renderiza mensagens restauradas
      this.messages.forEach((msg) => this.renderMessageDOM(msg));
    }

    attachEvents() {
      this.launcherEl.addEventListener("click", () => this.toggle());
      this.windowEl.querySelector("#girassolChatMinimize").addEventListener("click", () => this.close());

      this.formEl.addEventListener("submit", (e) => {
        e.preventDefault();
        this.handleSend();
      });

      // Fechar com ESC
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && this.isOpen) this.close();
      });
    }

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }

    open() {
      this.isOpen = true;
      this.windowEl.classList.add("active");
      this.launcherEl.style.opacity = "0.4";
      setTimeout(() => this.inputEl.focus(), 300);
      this.scrollToBottom();
    }

    close() {
      this.isOpen = false;
      this.windowEl.classList.remove("active");
      this.launcherEl.style.opacity = "1";
    }

    scrollToBottom() {
      setTimeout(() => {
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
      }, 50);
    }

    renderMessageDOM(msg) {
      const bubble = document.createElement("div");
      bubble.className = `chat-bubble ${msg.role}`;
      
      const timeStr = msg.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      const textNode = document.createTextNode(msg.text);
      bubble.appendChild(textNode);

      const timeNode = document.createElement("span");
      timeNode.className = "bubble-time";
      timeNode.textContent = timeStr;
      bubble.appendChild(timeNode);

      this.messagesContainer.appendChild(bubble);
      this.scrollToBottom();
    }

    addMessage(role, text) {
      const msg = {
        role,
        text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      this.messages.push(msg);
      this.renderMessageDOM(msg);
      this.saveSession();
    }

    setTyping(active) {
      if (active) {
        this.typingIndicator.classList.add("active");
      } else {
        this.typingIndicator.classList.remove("active");
      }
      this.scrollToBottom();
    }

    async ensureSession() {
      if (this.sessionId) return this.sessionId;
      try {
        const res = await fetch(`${this.apiBase}/web/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        if (res.ok) {
          const data = await res.json();
          this.sessionId = data.sessionId;
          this.saveSession();
          return this.sessionId;
        }
      } catch (err) {
        console.warn("[GirassolChat] Sessão inicial offline/local:", err);
      }
      this.sessionId = `web_${Date.now()}_local`;
      this.saveSession();
      return this.sessionId;
    }

    async handleSend() {
      const text = this.inputEl.value.trim();
      if (!text || this.isLoading) return;

      this.inputEl.value = "";
      this.addMessage("user", text);

      this.isLoading = true;
      this.setTyping(true);

      const sessionId = await this.ensureSession();

      try {
        const payload = {
          sessionId,
          text,
          turnstileToken: this.turnstileToken || undefined,
        };

        const response = await fetch(`${this.apiBase}/web/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        // Reset do token Turnstile para a próxima requisição
        if (this.turnstileWidgetId && window.turnstile) {
          try {
            window.turnstile.reset(this.turnstileWidgetId);
          } catch (e) {
            /* ignore */
          }
        }

        if (response.ok) {
          const data = await response.json();
          this.setTyping(false);
          this.addMessage("assistant", data.reply || "Resposta recebida do núcleo.");
          if (data.sessionId) {
            this.sessionId = data.sessionId;
            this.saveSession();
          }
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        console.error("[GirassolChat] Erro na comunicação:", error);
        this.setTyping(false);
        this.renderFallbackMessage();
      } finally {
        this.isLoading = false;
      }
    }

    renderFallbackMessage() {
      const bubble = document.createElement("div");
      bubble.className = "chat-bubble assistant";
      bubble.innerHTML = `
        <span>Nosso Núcleo de IA está em processo de sincronização de rede. Se preferir atendimento imediato com o mesmo agente, você pode continuar diretamente pelo WhatsApp oficial:</span>
        <div class="chat-whatsapp-banner">
          <a href="${WHATSAPP_LINK}" target="_blank" rel="noopener noreferrer" class="chat-whatsapp-link">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path></svg>
            Falar pelo WhatsApp Oficial
          </a>
        </div>
      `;
      this.messagesContainer.appendChild(bubble);
      this.scrollToBottom();
    }
  }

  // Inicializa quando a página estiver carregada
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => new GirassolChatWidget());
  } else {
    new GirassolChatWidget();
  }
})();
