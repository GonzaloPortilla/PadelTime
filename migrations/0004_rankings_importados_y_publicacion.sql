-- Padel Time · Fase 4: migración de rankings existentes y publicación web.
--
-- Los puntos de rankings anteriores (planillas Excel/CSV) se registran en el mismo libro de
-- movimientos como "Saldo inicial importado": un movimiento de tipo 'ajuste' vinculado a la
-- importación (balance_import_id). No se inventan torneos ni resultados históricos.
-- Revertir una importación agrega contraasientos ('anulacion_ajuste'); nada se borra.

-- ───────────────────────────── Importaciones ─────────────────────────────
CREATE TABLE ranking_imports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  token          TEXT    NOT NULL UNIQUE,              -- identificador interno del lote (UUID)
  file_name      TEXT    NOT NULL,
  file_hash      TEXT    NOT NULL,                     -- SHA-256 del archivo original
  content_hash   TEXT    NOT NULL,                     -- huella de las filas (jugador, ranking, puntos)
  sheet_names    TEXT,                                 -- hojas leídas (Excel)
  status         TEXT    NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente', 'revertida')),
  row_count      INTEGER NOT NULL DEFAULT 0,
  player_count   INTEGER NOT NULL DEFAULT 0,
  total_points   INTEGER NOT NULL DEFAULT 0,
  created_players INTEGER NOT NULL DEFAULT 0,
  skipped_rows   INTEGER NOT NULL DEFAULT 0,
  rankings       TEXT    NOT NULL DEFAULT '[]',        -- resumen JSON por temporada/categoría/división
  mapping        TEXT    NOT NULL DEFAULT '{}',        -- mapeo de columnas usado (auditoría)
  warnings       TEXT    NOT NULL DEFAULT '[]',        -- advertencias aceptadas al confirmar
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  reverted_at    TEXT,
  reverted_by    INTEGER REFERENCES users (id) ON DELETE SET NULL,
  revert_reason  TEXT,
  CHECK ((status = 'revertida') = (reverted_at IS NOT NULL))
);
-- El mismo archivo, o el mismo contenido en otro formato, no puede estar importado dos veces.
CREATE UNIQUE INDEX idx_rimports_file_vigente ON ranking_imports (file_hash) WHERE status = 'vigente';
CREATE UNIQUE INDEX idx_rimports_content_vigente ON ranking_imports (content_hash) WHERE status = 'vigente';

-- Movimientos de saldo inicial: referencia a su importación.
ALTER TABLE point_movements ADD COLUMN balance_import_id INTEGER REFERENCES ranking_imports (id) ON DELETE RESTRICT;
CREATE INDEX idx_movements_balance_import ON point_movements (balance_import_id) WHERE balance_import_id IS NOT NULL;

-- Una fila por jugador y ranking importado. Garantiza a nivel base de datos que un jugador
-- no reciba dos saldos iniciales vigentes en el mismo ranking (temporada + categoría + división).
CREATE TABLE initial_balances (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id        INTEGER NOT NULL REFERENCES ranking_imports (id) ON DELETE RESTRICT,
  row_number       INTEGER NOT NULL,                   -- fila del archivo (para rastrear el origen)
  source_name      TEXT    NOT NULL,                   -- nombre tal como figuraba en el archivo
  source_position  TEXT,                               -- posición que figuraba en el archivo (referencia)
  player_id        INTEGER NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  season_id        INTEGER NOT NULL REFERENCES seasons (id) ON DELETE RESTRICT,
  category_id      INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  division_id      INTEGER REFERENCES divisions (id) ON DELETE RESTRICT,
  division_key     INTEGER NOT NULL,                   -- COALESCE(division_id, 0), para el índice único
  points           INTEGER NOT NULL CHECK (points <> 0),
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  CHECK (division_key = COALESCE(division_id, 0))
);
CREATE UNIQUE INDEX idx_balances_unique ON initial_balances (season_id, category_id, division_key, player_id) WHERE active = 1;
CREATE INDEX idx_balances_import ON initial_balances (import_id);

-- Referencia temporal para vincular, dentro de la misma transacción, los jugadores nuevos que crea
-- una importación con sus filas. Se limpia al terminar (queda NULL).
ALTER TABLE players ADD COLUMN import_ref TEXT;
CREATE UNIQUE INDEX idx_players_import_ref ON players (import_ref) WHERE import_ref IS NOT NULL;

-- ───────────────────────────── Publicación ─────────────────────────────
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
INSERT INTO app_settings (key, value) VALUES
  ('public_enabled', '1'),        -- páginas públicas habilitadas
  ('public_show_history', '1'),   -- buscador e historial de jugadores
  ('public_title', 'Padel Time'), -- título de las páginas públicas
  ('public_version', '1');        -- se incrementa ante cualquier cambio visible (invalida la caché)

-- Temporadas visibles en la web (las planificadas nunca se muestran).
ALTER TABLE seasons ADD COLUMN public_visible INTEGER NOT NULL DEFAULT 1 CHECK (public_visible IN (0, 1));

-- Versión pública: cualquier cambio que afecte lo que se ve en la web la incrementa, así las
-- páginas en caché se regeneran solas al acreditar, revertir, importar o renombrar.
CREATE TRIGGER trg_pubver_movements AFTER INSERT ON point_movements
BEGIN
  UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version';
END;
CREATE TRIGGER trg_pubver_players AFTER UPDATE OF first_name, last_name, nickname, active ON players
BEGIN
  UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version';
END;
CREATE TRIGGER trg_pubver_categories AFTER UPDATE ON categories
BEGIN
  UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version';
END;
CREATE TRIGGER trg_pubver_divisions AFTER UPDATE ON divisions
BEGIN
  UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version';
END;
CREATE TRIGGER trg_pubver_seasons AFTER UPDATE ON seasons
BEGIN
  UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version';
END;
CREATE TRIGGER trg_pubver_tournaments AFTER UPDATE OF name, start_date ON tournaments
BEGIN
  UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version';
END;
CREATE TRIGGER trg_pubver_credits AFTER UPDATE OF status ON tournament_credits
BEGIN
  UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version';
END;
CREATE TRIGGER trg_pubver_settings AFTER UPDATE OF value ON app_settings WHEN NEW.key <> 'public_version'
BEGIN
  UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version';
END;
