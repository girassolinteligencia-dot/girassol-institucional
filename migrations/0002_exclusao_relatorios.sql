-- Pedidos de exclusão de dados (LGPD, art. 18) enviados pela página Exclusão de Dados
CREATE TABLE IF NOT EXISTS pedidos_exclusao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  telefone TEXT,
  status TEXT NOT NULL DEFAULT 'recebido',
  nota TEXT,
  concluido_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_exclusao_status ON pedidos_exclusao (status, criado_em);

-- Relatórios mensais gerados automaticamente (Cron) ou sob demanda pelo painel
CREATE TABLE IF NOT EXISTS relatorios (
  mes TEXT PRIMARY KEY, -- AAAA-MM
  gerado_em TEXT NOT NULL DEFAULT (datetime('now')),
  dados TEXT NOT NULL
);
