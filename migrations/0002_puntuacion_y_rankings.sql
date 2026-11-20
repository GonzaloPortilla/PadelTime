-- Padel Time · Migración 0002 · Motor de puntuación, acreditaciones y rankings (Fase 2)
--
-- Principio central: la tabla point_movements es la ÚNICA fuente de verdad de los puntos.
-- Es un registro contable de solo-agregar: no se modifica ni se borra (lo impiden triggers).
-- Los rankings se calculan siempre sumando movimientos; no existen totales editables.
-- Corregir o revertir una acreditación agrega movimientos compensatorios, conservando todo el historial.

-- ───────────────────────── Plantillas de puntuación ──────────────────────────
CREATE TABLE scoring_templates (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  description          TEXT,
  -- 0 = cada instancia otorga sólo sus puntos (regla general: el campeón recibe los puntos de campeón).
  -- 1 = reglamento especial: se suman los puntos de la instancia alcanzada y de todas las anteriores.
  cumulative           INTEGER NOT NULL DEFAULT 0 CHECK (cumulative IN (0, 1)),
  participation_bonus  INTEGER NOT NULL DEFAULT 0 CHECK (participation_bonus >= 0),
  match_played_bonus   INTEGER NOT NULL DEFAULT 0 CHECK (match_played_bonus >= 0),
  match_won_bonus      INTEGER NOT NULL DEFAULT 0 CHECK (match_won_bonus >= 0),
  default_for_type     TEXT    CHECK (default_for_type IN ('largo', 'americano')),
  active               INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Como máximo una plantilla predeterminada por tipo de torneo.
CREATE UNIQUE INDEX idx_templates_default_type ON scoring_templates (default_for_type) WHERE default_for_type IS NOT NULL;

-- Instancias de una plantilla. rank 1 = campeón, 2 = finalista, 3 = semifinal, ... (menor = mejor).
CREATE TABLE scoring_template_stages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id  INTEGER NOT NULL REFERENCES scoring_templates (id) ON DELETE CASCADE,
  label        TEXT    NOT NULL,
  rank         INTEGER NOT NULL CHECK (rank >= 1),
  points       INTEGER NOT NULL CHECK (points >= 0),
  max_teams    INTEGER CHECK (max_teams IS NULL OR max_teams >= 1),
  UNIQUE (template_id, rank),
  UNIQUE (template_id, label COLLATE NOCASE)
);

-- ─────────────── Puntuación de cada torneo (copia editable de una plantilla) ───────────────
CREATE TABLE tournament_scoring (
  tournament_id        INTEGER PRIMARY KEY REFERENCES tournaments (id) ON DELETE CASCADE,
  template_id          INTEGER REFERENCES scoring_templates (id) ON DELETE SET NULL,
  template_name        TEXT,                -- nombre de la plantilla de origen (referencia histórica)
  cumulative           INTEGER NOT NULL DEFAULT 0 CHECK (cumulative IN (0, 1)),
  participation_bonus  INTEGER NOT NULL DEFAULT 0 CHECK (participation_bonus >= 0),
  match_played_bonus   INTEGER NOT NULL DEFAULT 0 CHECK (match_played_bonus >= 0),
  match_won_bonus      INTEGER NOT NULL DEFAULT 0 CHECK (match_won_bonus >= 0),
  rules_notes          TEXT,                -- referencia al reglamento especial, si lo hay
  updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by           INTEGER REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE tournament_stages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  label          TEXT    NOT NULL,
  rank           INTEGER NOT NULL CHECK (rank >= 1),
  points         INTEGER NOT NULL CHECK (points >= 0),
  max_teams      INTEGER CHECK (max_teams IS NULL OR max_teams >= 1),
  UNIQUE (tournament_id, rank),
  UNIQUE (tournament_id, label COLLATE NOCASE)
);
CREATE INDEX idx_tstages_tournament ON tournament_stages (tournament_id);

-- ─────────────────────── Resultados de las parejas ───────────────────────────
ALTER TABLE tournament_teams ADD COLUMN stage_id INTEGER REFERENCES tournament_stages (id) ON DELETE SET NULL;
ALTER TABLE tournament_teams ADD COLUMN matches_played INTEGER NOT NULL DEFAULT 0 CHECK (matches_played >= 0);
ALTER TABLE tournament_teams ADD COLUMN matches_won INTEGER NOT NULL DEFAULT 0 CHECK (matches_won >= 0);
ALTER TABLE tournament_teams ADD COLUMN updated_at TEXT;
CREATE INDEX idx_teams_stage ON tournament_teams (stage_id);

-- ───────────────────── Reglas de desempate por temporada ─────────────────────
-- Arreglo JSON ordenado de criterios (ver shared/constants.ts). NULL = criterios predeterminados.
ALTER TABLE seasons ADD COLUMN tiebreakers TEXT;

-- ─────────────────────── Acreditaciones de torneos ───────────────────────────
-- Cada confirmación de un organizador genera una acreditación (versión 1, 2, ...).
-- Sólo puede haber UNA vigente por torneo: es la garantía de que un torneo no se acredita dos veces.
CREATE TABLE tournament_credits (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id       INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE RESTRICT,
  season_id           INTEGER NOT NULL REFERENCES seasons (id) ON DELETE RESTRICT,
  version             INTEGER NOT NULL CHECK (version >= 1),
  status              TEXT    NOT NULL DEFAULT 'vigente' CHECK (status IN ('vigente', 'reemplazada', 'revertida')),
  preview_hash        TEXT    NOT NULL,     -- huella de la previsualización confirmada
  total_points        INTEGER NOT NULL DEFAULT 0,
  player_count        INTEGER NOT NULL DEFAULT 0,
  team_count          INTEGER NOT NULL DEFAULT 0,
  reason              TEXT,                 -- motivo (obligatorio en correcciones)
  replaces_credit_id  INTEGER REFERENCES tournament_credits (id) ON DELETE RESTRICT,
  created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by          INTEGER REFERENCES users (id) ON DELETE SET NULL,
  closed_at           TEXT,
  closed_by           INTEGER REFERENCES users (id) ON DELETE SET NULL,
  close_reason        TEXT,
  UNIQUE (tournament_id, version)
);
CREATE UNIQUE INDEX idx_credits_single_active ON tournament_credits (tournament_id) WHERE status = 'vigente';
CREATE INDEX idx_credits_season ON tournament_credits (season_id);

-- ───────────────── Movimientos de puntos (fuente de verdad) ──────────────────
-- kind:
--   acreditacion      puntos otorgados por una acreditación de torneo
--   reversion         contraasiento de una acreditación (corrección o reversión): -puntos
--   ajuste            ajuste manual de un organizador (+/-), siempre con motivo
--   anulacion_ajuste  contraasiento de un ajuste manual
CREATE TABLE point_movements (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id             INTEGER NOT NULL REFERENCES seasons (id) ON DELETE RESTRICT,
  player_id             INTEGER NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  category_id           INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT, -- categoría principal acreditada
  division_id           INTEGER REFERENCES divisions (id) ON DELETE RESTRICT,
  kind                  TEXT    NOT NULL CHECK (kind IN ('acreditacion', 'reversion', 'ajuste', 'anulacion_ajuste')),
  points                INTEGER NOT NULL,
  stage_points          INTEGER NOT NULL DEFAULT 0,
  bonus_points          INTEGER NOT NULL DEFAULT 0,
  tournament_id         INTEGER REFERENCES tournaments (id) ON DELETE RESTRICT,
  credit_id             INTEGER REFERENCES tournament_credits (id) ON DELETE RESTRICT,
  team_id               INTEGER,              -- referencia histórica (sin FK: la pareja puede editarse luego)
  partner_name          TEXT,                 -- compañero/a al momento de acreditar
  stage_label           TEXT,
  stage_rank            INTEGER,
  matches_played        INTEGER NOT NULL DEFAULT 0,
  matches_won           INTEGER NOT NULL DEFAULT 0,
  reverses_movement_id  INTEGER UNIQUE REFERENCES point_movements (id) ON DELETE RESTRICT,
  reason                TEXT,
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by            INTEGER REFERENCES users (id) ON DELETE SET NULL,
  CHECK ((kind IN ('acreditacion', 'reversion')) = (tournament_id IS NOT NULL AND credit_id IS NOT NULL)),
  CHECK ((kind IN ('reversion', 'anulacion_ajuste')) = (reverses_movement_id IS NOT NULL)),
  CHECK (kind <> 'ajuste' OR (reason IS NOT NULL AND points <> 0))
);
-- Un jugador recibe a lo sumo un movimiento de cada tipo por acreditación.
CREATE UNIQUE INDEX idx_movements_credit_player ON point_movements (credit_id, player_id, kind) WHERE credit_id IS NOT NULL;
CREATE INDEX idx_movements_ranking ON point_movements (season_id, category_id, division_id);
CREATE INDEX idx_movements_player ON point_movements (player_id, season_id);
CREATE INDEX idx_movements_tournament ON point_movements (tournament_id);

CREATE TRIGGER trg_movements_immutable_update BEFORE UPDATE ON point_movements
BEGIN
  SELECT RAISE(ABORT, 'Los movimientos de puntos son inmutables: registrá un movimiento compensatorio');
END;

CREATE TRIGGER trg_movements_immutable_delete BEFORE DELETE ON point_movements
BEGIN
  SELECT RAISE(ABORT, 'Los movimientos de puntos son inmutables: registrá un movimiento compensatorio');
END;

-- ─────────────────────── Plantillas iniciales ────────────────────────────────
INSERT INTO scoring_templates (name, description, default_for_type) VALUES
  ('Torneo largo estándar', 'Puntaje base para torneos largos. Editable.', 'largo'),
  ('Americano estándar', 'Puntaje base para americanos de un día. Editable.', 'americano');

INSERT INTO scoring_template_stages (template_id, label, rank, points, max_teams) VALUES
  ((SELECT id FROM scoring_templates WHERE name = 'Torneo largo estándar'), 'Campeón', 1, 100, 1),
  ((SELECT id FROM scoring_templates WHERE name = 'Torneo largo estándar'), 'Finalista', 2, 70, 1),
  ((SELECT id FROM scoring_templates WHERE name = 'Torneo largo estándar'), 'Semifinal', 3, 50, 2),
  ((SELECT id FROM scoring_templates WHERE name = 'Torneo largo estándar'), 'Cuartos de final', 4, 30, 4),
  ((SELECT id FROM scoring_templates WHERE name = 'Torneo largo estándar'), 'Octavos de final', 5, 15, 8),
  ((SELECT id FROM scoring_templates WHERE name = 'Torneo largo estándar'), '16avos de final', 6, 8, 16),
  ((SELECT id FROM scoring_templates WHERE name = 'Torneo largo estándar'), 'Fase de grupos', 7, 5, NULL);

INSERT INTO scoring_template_stages (template_id, label, rank, points, max_teams) VALUES
  ((SELECT id FROM scoring_templates WHERE name = 'Americano estándar'), 'Campeón', 1, 50, 1),
  ((SELECT id FROM scoring_templates WHERE name = 'Americano estándar'), 'Finalista', 2, 35, 1),
  ((SELECT id FROM scoring_templates WHERE name = 'Americano estándar'), 'Semifinal', 3, 25, 2),
  ((SELECT id FROM scoring_templates WHERE name = 'Americano estándar'), 'Cuartos de final', 4, 15, 4),
  ((SELECT id FROM scoring_templates WHERE name = 'Americano estándar'), 'Fase de grupos', 5, 5, NULL);
