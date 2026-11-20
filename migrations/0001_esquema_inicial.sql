-- Padel Time · Migración 0001 · Esquema inicial (Fase 1)
-- Convenciones:
--   * Fechas de calendario: TEXT 'YYYY-MM-DD'. Marcas de tiempo: TEXT ISO-8601 UTC.
--   * Rama ('gender'): 'M' = Caballeros, 'F' = Damas.
--   * Los registros con historia (jugadores, categorías, usuarios) no se borran: se desactivan.
--   * D1 aplica las claves foráneas por defecto.

-- ─────────────────────────────── Organizadores ───────────────────────────────
CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username       TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  display_name   TEXT    NOT NULL,
  password_hash  TEXT    NOT NULL,           -- 'pbkdf2-sha256$<iteraciones>$<salt b64>$<hash b64>'
  role           TEXT    NOT NULL DEFAULT 'organizador' CHECK (role IN ('admin', 'organizador')),
  active         INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_login_at  TEXT
);

-- Sesiones: se guarda el SHA-256 del token, nunca el token en claro.
CREATE TABLE sessions (
  id            TEXT    PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at    TEXT    NOT NULL,
  user_agent    TEXT
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- Control de intentos fallidos de ingreso (por usuario y por IP).
CREATE TABLE login_attempts (
  key           TEXT    PRIMARY KEY,         -- 'u:<usuario>' o 'ip:<dirección>'
  failures      INTEGER NOT NULL DEFAULT 0,
  window_start  TEXT    NOT NULL,
  locked_until  TEXT
);

-- Registro de actividad de los organizadores.
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  action      TEXT    NOT NULL,              -- 'crear', 'editar', 'desactivar', ...
  entity      TEXT    NOT NULL,              -- 'jugador', 'torneo', ...
  entity_id   INTEGER,
  summary     TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_audit_created ON audit_log (created_at DESC);

-- ─────────────────────────── Categorías y divisiones ─────────────────────────
-- Una categoría pertenece a una rama. 'level' ordena de mayor a menor nivel (1 = la más alta).
CREATE TABLE categories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL,
  gender       TEXT    NOT NULL CHECK (gender IN ('M', 'F')),
  level        INTEGER NOT NULL DEFAULT 1 CHECK (level >= 1),
  description  TEXT,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (gender, name COLLATE NOCASE)
);
CREATE INDEX idx_categories_gender_level ON categories (gender, level);

-- Subdivisiones opcionales de una categoría (p. ej. 'A' / 'B', 'Oro' / 'Plata').
CREATE TABLE divisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id  INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  name         TEXT    NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 1,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (category_id, name COLLATE NOCASE)
);

-- ───────────────────────────────── Jugadores ─────────────────────────────────
-- 'id' es el identificador interno inmutable (nunca se reutiliza: AUTOINCREMENT).
-- 'code' es un código legible derivado del id (J-00001) para distinguir homónimos.
-- 'main_category_id' define en qué ranking acumula puntos, aunque juegue otra categoría.
CREATE TABLE players (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT    UNIQUE,
  first_name        TEXT    NOT NULL,
  last_name         TEXT    NOT NULL,
  nickname          TEXT,
  gender            TEXT    NOT NULL CHECK (gender IN ('M', 'F')),
  main_category_id  INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  document_number   TEXT    UNIQUE,          -- DNI opcional; si se carga, no puede repetirse
  phone             TEXT,
  email             TEXT,
  birth_date        TEXT,
  city              TEXT,
  notes             TEXT,
  search_text       TEXT    NOT NULL DEFAULT '', -- nombre normalizado (minúsculas, sin acentos)
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by        INTEGER REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX idx_players_category ON players (main_category_id);
CREATE INDEX idx_players_gender_active ON players (gender, active);
CREATE INDEX idx_players_name ON players (last_name COLLATE NOCASE, first_name COLLATE NOCASE);

CREATE TRIGGER trg_players_code AFTER INSERT ON players
WHEN NEW.code IS NULL
BEGIN
  UPDATE players SET code = printf('J-%05d', NEW.id) WHERE id = NEW.id;
END;

-- Historial de cambios de categoría principal (base para ascensos/descensos de fases futuras).
CREATE TABLE player_category_changes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id         INTEGER NOT NULL REFERENCES players (id) ON DELETE CASCADE,
  from_category_id  INTEGER REFERENCES categories (id) ON DELETE RESTRICT,  -- NULL = alta inicial
  to_category_id    INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  season_id         INTEGER REFERENCES seasons (id) ON DELETE SET NULL,
  change_type       TEXT    NOT NULL DEFAULT 'manual'
                    CHECK (change_type IN ('alta', 'manual', 'ascenso', 'descenso')),
  reason            TEXT,
  effective_date    TEXT    NOT NULL,
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by        INTEGER REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX idx_pcc_player ON player_category_changes (player_id, effective_date);

-- ──────────────────────────────── Temporadas ─────────────────────────────────
CREATE TABLE seasons (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  year        INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  start_date  TEXT    NOT NULL,
  end_date    TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'planificada' CHECK (status IN ('planificada', 'activa', 'cerrada')),
  notes       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (end_date >= start_date)
);
-- Como máximo una temporada activa a la vez.
CREATE UNIQUE INDEX idx_seasons_single_active ON seasons (status) WHERE status = 'activa';

-- ───────────────────────────────── Torneos ───────────────────────────────────
-- 'largo': se juega en varias fechas. 'americano': se juega en un único día.
CREATE TABLE tournaments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  season_id    INTEGER NOT NULL REFERENCES seasons (id) ON DELETE RESTRICT,
  name         TEXT    NOT NULL,
  type         TEXT    NOT NULL CHECK (type IN ('largo', 'americano')),
  category_id  INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  division_id  INTEGER REFERENCES divisions (id) ON DELETE RESTRICT,
  start_date   TEXT    NOT NULL,
  end_date     TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'programado'
               CHECK (status IN ('programado', 'en_curso', 'finalizado', 'cancelado')),
  venue        TEXT,
  notes        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  CHECK (end_date >= start_date),
  CHECK (type <> 'americano' OR end_date = start_date)
);
CREATE INDEX idx_tournaments_season ON tournaments (season_id, start_date);
CREATE INDEX idx_tournaments_category ON tournaments (category_id);
CREATE INDEX idx_tournaments_status_date ON tournaments (status, start_date);

-- ─────────────────── Parejas por torneo (base para fases 2+) ─────────────────
-- Las parejas son fijas dentro de un torneo. Cada jugador figura una sola vez por torneo.
-- 'ranking_category_id' congela la categoría principal del jugador al inscribirse,
-- que es la que recibirá los puntos de ese torneo.
CREATE TABLE tournament_teams (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id  INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  seed           INTEGER,
  final_position INTEGER,                    -- se completará con los resultados
  notes          TEXT,
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_teams_tournament ON tournament_teams (tournament_id);

CREATE TABLE tournament_team_players (
  team_id              INTEGER NOT NULL REFERENCES tournament_teams (id) ON DELETE CASCADE,
  tournament_id        INTEGER NOT NULL REFERENCES tournaments (id) ON DELETE CASCADE,
  player_id            INTEGER NOT NULL REFERENCES players (id) ON DELETE RESTRICT,
  ranking_category_id  INTEGER NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  PRIMARY KEY (team_id, player_id),
  UNIQUE (tournament_id, player_id)
);
CREATE INDEX idx_ttp_player ON tournament_team_players (player_id);
