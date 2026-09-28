-- Login do painel por senha + código de duas etapas (TOTP)

-- Tentativas de login, para bloquear força bruta (5 erros em 15 minutos por endereço)
CREATE TABLE IF NOT EXISTS login_tentativas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  ip TEXT NOT NULL,
  sucesso INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_login_ip_data ON login_tentativas (ip, criado_em);

-- Último código de duas etapas aceito: impede reutilizar o mesmo código
CREATE TABLE IF NOT EXISTS totp_uso (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ultimo_contador INTEGER NOT NULL
);
