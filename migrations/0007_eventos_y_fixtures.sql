-- Padel Time · Migración 0007 · Eventos con varias categorías y fixtures de torneos largos (Fase 9)
--
-- Sólo agrega estructuras: no modifica ni borra torneos, parejas, acreditaciones ni movimientos.
--  * tournament_events: un evento general (p. ej. "Qatar Major 2000") que agrupa varias categorías.
--    Cada categoría sigue siendo un torneo (tabla tournaments) con sus parejas, puntuación y acreditación,
--    así que el motor de puntos y los torneos ya registrados no cambian. tournaments.event_id es opcional.
--  * tournament_fixtures: configuración y versión del fixture de UN torneo largo (una categoría).
--  * fixture_groups / fixture_group_teams: grupos y sus parejas (las de tournament_teams, sin duplicar).
--  * fixture_matches: partidos de grupos y de los cuadros (Copa de Oro, Copa de Plata o cuadro único).
--  * fixture_match_history: cada carga, corrección o anulación de resultado, con autor, fecha y motivo.
--  * fixture_publications: la copia publicada del fixture (lo que ve la web pública).
-- Los Satélites / Americanos no usan estas tablas (lo controla la API).

CREATE TABLE tournament_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id    INTEGER NOT NULL REFERENCES seasons (id) ON DELETE RESTRICT,
  name         TEXT    NOT NULL,
  series       TEXT    CHECK (series IS NULL OR series IN ('open_1000', 'challenger_500', 'satelite_100', 'master_2000', 'otro')),
  start_date   TEXT    NOT NULL,
  end_date     TEXT    NOT NULL,
  venue        TEXT,
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_events_season ON tournament_events (season_id, start_date);

ALTER TABLE tournaments ADD COLUMN event_id INTEGER REFERENCES tournament_events (id) ON DELETE SET NULL;
CREATE INDEX idx_tournaments_event ON tournaments (event_id);

-- Retiro de una pareja después de empezada la competencia (la pareja no se borra: queda en la historia).
ALTER TABLE tournament_teams ADD COLUMN withdrawn_at TEXT;
ALTER TABLE tournament_teams ADD COLUMN withdrawn_reason TEXT;

CREATE TABLE tournament_fixtures (
  tournament_id  INTEGER PRIMARY KEY REFERENCES tournaments (id) ON DELETE CASCADE,
  config         TEXT    NOT NULL DEFAULT '{}',   -- JSON (ver shared/fixture.ts)
  version        INTEGER NOT NULL DEFAULT 1,      -- control de edición simultánea
  op_token       TEXT,                            -- marca de la última operación (protege los lotes de escritura)
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by     INTEGER REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE fixture_groups (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  manual_order   TEXT,                            -- JSON: orden definido a mano para empates sin resolver
  UNIQUE (tournament_id, name)
);

CREATE TABLE fixture_group_teams (
  group_id       INTEGER NOT NULL REFERENCES fixture_groups (id) ON DELETE CASCADE,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  team_id        INTEGER NOT NULL REFERENCES tournament_teams (id) ON DELETE RESTRICT,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, team_id),
  UNIQUE (tournament_id, team_id)                 -- una pareja está en un solo grupo
);

CREATE TABLE fixture_matches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id   INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  phase           TEXT    NOT NULL CHECK (phase IN ('grupos', 'oro', 'plata', 'cuadro')),
  group_id        INTEGER REFERENCES fixture_groups (id) ON DELETE CASCADE,
  round           INTEGER NOT NULL CHECK (round >= 1),  -- grupos: fecha; cuadros: ronda (1 = primera)
  slot            INTEGER NOT NULL CHECK (slot >= 0),
  team1_id        INTEGER REFERENCES tournament_teams (id) ON DELETE RESTRICT,
  team2_id        INTEGER REFERENCES tournament_teams (id) ON DELETE RESTRICT,
  source1         TEXT,                            -- JSON: origen del lugar en la 1ª ronda de un cuadro
  source2         TEXT,
  scheduled_date  TEXT,
  scheduled_time  TEXT,
  court           TEXT,
  status          TEXT    NOT NULL DEFAULT 'pendiente'
                  CHECK (status IN ('pendiente', 'jugado', 'retiro', 'wo', 'administrativo', 'bye')),
  winner          INTEGER CHECK (winner IS NULL OR winner IN (1, 2)),
  sets            TEXT    NOT NULL DEFAULT '[]',   -- JSON [[6,4],[7,6]] desde la pareja 1
  notes           TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by      INTEGER REFERENCES users (id) ON DELETE SET NULL,
  CHECK (phase = 'grupos' OR group_id IS NULL),
  CHECK (phase <> 'grupos' OR group_id IS NOT NULL),
  CHECK (status = 'pendiente' OR winner IS NOT NULL),
  CHECK (team1_id IS NULL OR team2_id IS NULL OR team1_id <> team2_id)
);
CREATE UNIQUE INDEX idx_fixture_match_place ON fixture_matches (tournament_id, phase, IFNULL(group_id, 0), round, slot);
CREATE INDEX idx_fixture_match_team1 ON fixture_matches (team1_id);
CREATE INDEX idx_fixture_match_team2 ON fixture_matches (team2_id);

CREATE TABLE fixture_match_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  match_id       INTEGER NOT NULL,                 -- sin FK: el historial sobrevive si se regenera el cuadro
  action         TEXT    NOT NULL CHECK (action IN ('resultado', 'correccion', 'anulacion', 'programacion', 'retiro')),
  before_json    TEXT,
  after_json     TEXT,
  reason         TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by     INTEGER REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX idx_fixture_history_tournament ON fixture_match_history (tournament_id, created_at DESC);

CREATE TABLE fixture_publications (
  tournament_id  INTEGER PRIMARY KEY REFERENCES tournaments (id) ON DELETE CASCADE,
  data           TEXT    NOT NULL,                 -- JSON (PublicFixture en shared/fixture.ts)
  fixture_version INTEGER NOT NULL,                -- versión del fixture publicada
  published_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  published_by   INTEGER REFERENCES users (id) ON DELETE SET NULL
);

-- La web pública muestra sólo lo publicado: se invalida su caché al publicar u ocultar un fixture,
-- y al cambiar un evento (nombre, fechas) o la pertenencia de un torneo a un evento (trigger de tournaments).
CREATE TRIGGER trg_pubver_fixture_pub_ins AFTER INSERT ON fixture_publications
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_fixture_pub_upd AFTER UPDATE ON fixture_publications
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_fixture_pub_del AFTER DELETE ON fixture_publications
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_events_upd AFTER UPDATE ON tournament_events
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_events_del AFTER DELETE ON tournament_events
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
-- El retiro de una pareja cambia lo que se ve en la página del torneo.
CREATE TRIGGER trg_pubver_teams_withdraw AFTER UPDATE OF withdrawn_at ON tournament_teams
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
