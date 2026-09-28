-- Girassol Inteligência — banco D1 do site

-- Configuração publicada pelo painel (uma linha)
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  dados TEXT NOT NULL,
  atualizado_em TEXT NOT NULL,
  atualizado_por TEXT
);

-- Últimas 30 versões salvas, para desfazer publicações
CREATE TABLE IF NOT EXISTS config_historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dados TEXT NOT NULL,
  salvo_em TEXT NOT NULL DEFAULT (datetime('now')),
  salvo_por TEXT
);

-- Métricas anônimas: sem cookies, sem IP, sem identificação do visitante
CREATE TABLE IF NOT EXISTS eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  tipo TEXT NOT NULL,
  assunto TEXT,
  pagina TEXT,
  origem TEXT,
  dispositivo TEXT
);
CREATE INDEX IF NOT EXISTS idx_eventos_data_tipo ON eventos (criado_em, tipo);

-- Leads: criados só quando o visitante envia o resumo à equipe pelo WhatsApp
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  assunto TEXT,
  resumo TEXT NOT NULL,
  pagina TEXT,
  dispositivo TEXT,
  status TEXT NOT NULL DEFAULT 'novo',
  nota TEXT,
  atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_data ON leads (criado_em);
