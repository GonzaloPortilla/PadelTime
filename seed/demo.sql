-- Datos de demostración para desarrollo local (npm run db:seed:local).
-- No ejecutar en producción.
INSERT INTO categories (name, gender, level) VALUES
  ('3ra', 'M', 3), ('4ta', 'M', 4), ('5ta', 'M', 5), ('6ta', 'M', 6), ('7ma', 'M', 7),
  ('4ta', 'F', 4), ('5ta', 'F', 5), ('6ta', 'F', 6), ('7ma', 'F', 7);

INSERT INTO divisions (category_id, name, sort_order)
  SELECT id, 'A', 1 FROM categories WHERE gender = 'M' AND name = '6ta';
INSERT INTO divisions (category_id, name, sort_order)
  SELECT id, 'B', 2 FROM categories WHERE gender = 'M' AND name = '6ta';

INSERT INTO seasons (name, year, start_date, end_date, status) VALUES
  ('Temporada 2025', 2025, '2025-01-01', '2025-12-31', 'cerrada'),
  ('Temporada 2026', 2026, '2026-01-01', '2026-12-31', 'activa');

INSERT INTO players (first_name, last_name, nickname, gender, main_category_id, city, search_text) VALUES
  ('Juan', 'Pérez', NULL, 'M', (SELECT id FROM categories WHERE gender='M' AND name='4ta'), 'Córdoba', 'juan perez'),
  ('Juan', 'Pérez', 'Juancho', 'M', (SELECT id FROM categories WHERE gender='M' AND name='6ta'), 'Villa Carlos Paz', 'juan perez juancho'),
  ('Martín', 'Gómez', NULL, 'M', (SELECT id FROM categories WHERE gender='M' AND name='4ta'), 'Córdoba', 'martin gomez'),
  ('Lucas', 'Fernández', 'Tano', 'M', (SELECT id FROM categories WHERE gender='M' AND name='5ta'), 'Río Cuarto', 'lucas fernandez tano'),
  ('Diego', 'Sosa', NULL, 'M', (SELECT id FROM categories WHERE gender='M' AND name='5ta'), NULL, 'diego sosa'),
  ('Nicolás', 'Romero', NULL, 'M', (SELECT id FROM categories WHERE gender='M' AND name='3ra'), 'Córdoba', 'nicolas romero'),
  ('Facundo', 'Díaz', NULL, 'M', (SELECT id FROM categories WHERE gender='M' AND name='7ma'), NULL, 'facundo diaz'),
  ('Sofía', 'Martínez', NULL, 'F', (SELECT id FROM categories WHERE gender='F' AND name='5ta'), 'Córdoba', 'sofia martinez'),
  ('Valentina', 'López', 'Vale', 'F', (SELECT id FROM categories WHERE gender='F' AND name='5ta'), 'Alta Gracia', 'valentina lopez vale'),
  ('Camila', 'Núñez', NULL, 'F', (SELECT id FROM categories WHERE gender='F' AND name='4ta'), NULL, 'camila nunez'),
  ('Lucía', 'Acosta', NULL, 'F', (SELECT id FROM categories WHERE gender='F' AND name='6ta'), 'Córdoba', 'lucia acosta');

INSERT INTO player_category_changes (player_id, to_category_id, season_id, change_type, effective_date)
  SELECT id, main_category_id, (SELECT id FROM seasons WHERE status = 'activa'), 'alta', '2026-02-01' FROM players;

INSERT INTO tournaments (season_id, name, type, category_id, division_id, start_date, end_date, status, venue) VALUES
  ((SELECT id FROM seasons WHERE year=2026), 'Torneo Apertura', 'largo', (SELECT id FROM categories WHERE gender='M' AND name='4ta'), NULL, '2026-03-02', '2026-04-26', 'finalizado', 'Club Padel Norte'),
  ((SELECT id FROM seasons WHERE year=2026), 'Americano de Otoño', 'americano', (SELECT id FROM categories WHERE gender='F' AND name='5ta'), NULL, '2026-05-16', '2026-05-16', 'finalizado', 'Complejo La Red'),
  ((SELECT id FROM seasons WHERE year=2026), 'Torneo Clausura', 'largo', (SELECT id FROM categories WHERE gender='M' AND name='5ta'), NULL, '2026-10-05', '2026-12-06', 'en_curso', 'Club Padel Norte'),
  ((SELECT id FROM seasons WHERE year=2026), 'Americano Fin de Año', 'americano', (SELECT id FROM categories WHERE gender='M' AND name='6ta'), (SELECT d.id FROM divisions d JOIN categories c ON c.id = d.category_id WHERE c.gender='M' AND c.name='6ta' AND d.name='A'), '2026-12-12', '2026-12-12', 'programado', 'Complejo La Red'),
  ((SELECT id FROM seasons WHERE year=2026), 'Americano Damas Navidad', 'americano', (SELECT id FROM categories WHERE gender='F' AND name='4ta'), NULL, '2026-12-19', '2026-12-19', 'programado', NULL);

-- ─── Fase 2: puntuación de los torneos demo (copia de la plantilla de su tipo) ───
INSERT INTO tournament_scoring (tournament_id, template_id, template_name, cumulative, participation_bonus, match_played_bonus, match_won_bonus)
  SELECT t.id, st.id, st.name, st.cumulative, st.participation_bonus, st.match_played_bonus, st.match_won_bonus
    FROM tournaments t JOIN scoring_templates st ON st.default_for_type = t.type;
INSERT INTO tournament_stages (tournament_id, label, rank, points, max_teams)
  SELECT t.id, s.label, s.rank, s.points, s.max_teams
    FROM tournaments t JOIN scoring_templates st ON st.default_for_type = t.type JOIN scoring_template_stages s ON s.template_id = st.id;

-- Parejas del Torneo Apertura (finalizado, sin resultados cargados todavía).
INSERT INTO tournament_teams (tournament_id, seed) VALUES
  ((SELECT id FROM tournaments WHERE name = 'Torneo Apertura'), 1),
  ((SELECT id FROM tournaments WHERE name = 'Torneo Apertura'), 2),
  ((SELECT id FROM tournaments WHERE name = 'Torneo Apertura'), NULL);
INSERT INTO tournament_team_players (team_id, tournament_id, player_id, ranking_category_id)
  SELECT tt.id, tt.tournament_id, p.id, p.main_category_id
    FROM tournament_teams tt JOIN players p
      ON (tt.seed = 1 AND p.code IN ('J-00001', 'J-00003'))
      OR (tt.seed = 2 AND p.code IN ('J-00004', 'J-00005'))
      OR (tt.seed IS NULL AND p.code IN ('J-00006', 'J-00007'))
   WHERE tt.tournament_id = (SELECT id FROM tournaments WHERE name = 'Torneo Apertura');
