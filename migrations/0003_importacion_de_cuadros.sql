-- Padel Time · Migración 0003 · Importación de cuadros por imagen (Fase 3)
--
-- El reconocimiento (OCR) corre en el navegador y sólo PROPONE resultados. Lo que el organizador
-- confirma se guarda como parejas e instancias del torneo; los puntos se acreditan después,
-- con el flujo normal de previsualización y confirmación (Fase 2).
-- Esta tabla deja constancia de cada importación: origen, qué se leyó y qué se corrigió.

CREATE TABLE bracket_imports (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id     INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  file_name         TEXT,
  recognition_mode  TEXT    NOT NULL CHECK (recognition_mode IN ('estructura', 'texto', 'manual')),
  import_mode       TEXT    NOT NULL CHECK (import_mode IN ('reemplazar', 'agregar')),
  team_count        INTEGER NOT NULL DEFAULT 0,
  created_players   INTEGER NOT NULL DEFAULT 0,
  corrected_fields  INTEGER NOT NULL DEFAULT 0,
  elapsed_ms        INTEGER,
  -- JSON: advertencias que el organizador vio y aceptó al confirmar.
  warnings          TEXT    NOT NULL DEFAULT '[]',
  -- JSON: por pareja, texto leído, jugadores vinculados, instancia y si fue corregida a mano.
  summary           TEXT    NOT NULL DEFAULT '[]',
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by        INTEGER REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX idx_imports_tournament ON bracket_imports (tournament_id, created_at DESC);
