-- Padel Time · Migración 0009 · Del fixture a la puntuación (Fase 10)
--
-- Sólo agrega una columna: la equivalencia entre la posición final en el fixture (Campeón de Oro,
-- Semifinal de Plata, Fase de grupos…) y la instancia de la puntuación del torneo (tournament_stages).
-- Los puntos se siguen calculando y acreditando con el motor y el registro de movimientos existentes.
ALTER TABLE tournament_fixtures ADD COLUMN stage_map TEXT;  -- JSON {"oro:1": <stage_id>, "grupos": <stage_id>, …}
