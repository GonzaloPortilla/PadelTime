-- Padel Time · Migración 0008 · Torneos con varias categorías
--
-- Modelo (sin entidades nuevas):
--   * Torneo      = tournament_events: el evento general (nombre, tipo, fechas, información pública).
--   * Competencia = tournaments: la participación de UNA categoría (y división opcional) dentro de UN torneo.
--     Cada competencia conserva todo lo que ya tenía: parejas, fixture, puntuación, acreditación,
--     movimientos de puntos, importaciones de cuadros e historial.
--
-- Esta migración sólo AGREGA columnas, datos e índices:
--   1. Los datos generales y públicos pasan a guardarse también en el torneo (se copian a sus competencias).
--   2. Cada torneo anterior de una sola categoría queda como un torneo con una competencia
--      (mismo id de competencia: sus puntos, resultados, enlaces y rankings no cambian).
--   3. Una categoría (y división) no puede repetirse dentro de un mismo torneo.

ALTER TABLE tournament_events ADD COLUMN type TEXT NOT NULL DEFAULT 'largo' CHECK (type IN ('largo', 'americano'));
ALTER TABLE tournament_events ADD COLUMN public_description TEXT;
ALTER TABLE tournament_events ADD COLUMN prize_info TEXT;
ALTER TABLE tournament_events ADD COLUMN public_visible INTEGER NOT NULL DEFAULT 0 CHECK (public_visible IN (0, 1));
ALTER TABLE tournament_events ADD COLUMN featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1));
ALTER TABLE tournament_events ADD COLUMN registration_open INTEGER NOT NULL DEFAULT 0 CHECK (registration_open IN (0, 1));
-- Torneo de una categoría que originó este torneo al migrar (referencia histórica).
ALTER TABLE tournament_events ADD COLUMN source_tournament_id INTEGER;

-- 1. Torneos (eventos) ya creados en la Fase 9: toman los datos públicos de su primera competencia.
UPDATE tournament_events SET
  type               = COALESCE((SELECT t.type FROM tournaments t WHERE t.event_id = tournament_events.id ORDER BY t.id LIMIT 1), 'largo'),
  public_description = (SELECT t.public_description FROM tournaments t WHERE t.event_id = tournament_events.id ORDER BY t.id LIMIT 1),
  prize_info         = (SELECT t.prize_info FROM tournaments t WHERE t.event_id = tournament_events.id ORDER BY t.id LIMIT 1),
  public_visible     = COALESCE((SELECT MAX(t.public_visible) FROM tournaments t WHERE t.event_id = tournament_events.id), 0),
  featured           = COALESCE((SELECT MAX(t.featured) FROM tournaments t WHERE t.event_id = tournament_events.id), 0),
  registration_open  = COALESCE((SELECT MAX(t.registration_open) FROM tournaments t WHERE t.event_id = tournament_events.id), 0);

-- 2. Torneos anteriores (una categoría, sin evento): se crea su torneo general y se enlaza.
INSERT INTO tournament_events (season_id, name, series, start_date, end_date, venue, created_at, created_by,
                               type, public_description, prize_info, public_visible, featured, registration_open, source_tournament_id)
SELECT season_id, name, series, start_date, end_date, venue, created_at, created_by,
       type, public_description, prize_info, public_visible, featured, registration_open, id
  FROM tournaments WHERE event_id IS NULL;

UPDATE tournaments SET event_id = (SELECT e.id FROM tournament_events e WHERE e.source_tournament_id = tournaments.id)
 WHERE event_id IS NULL;

-- 3. Una competencia por categoría (y división) dentro de cada torneo.
CREATE UNIQUE INDEX idx_tournaments_event_category ON tournaments (event_id, category_id, IFNULL(division_id, 0));

-- La web pública se actualiza también al crear un torneo.
CREATE TRIGGER trg_pubver_events_ins AFTER INSERT ON tournament_events
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
