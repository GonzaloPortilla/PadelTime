-- Padel Time · Migración 0005 · Web pública oficial (Fase 7)
--
-- Sólo agrega estructuras: no modifica ni borra datos existentes.
--  * site_pages:  páginas de contenido (por bloques JSON validados en shared/site.ts). Se editarán desde el panel en la Fase 8.
--  * site_posts:  novedades (vacía: se cargan desde el panel en la Fase 8).
--  * site_events: eventos del calendario que no son torneos (canchas abiertas, cenas, cierres de inscripción…).
--  * tournaments: datos públicos (modalidad, publicación, destacado, descripción, premios, inscripción abierta).
--  * app_settings: datos de la web (WhatsApp, Instagram, sede, aviso destacado, ramas activas).
-- Los textos sembrados son los publicados en www.padeltime.com.ar (portada y reglamento), sin agregados.

CREATE TABLE site_pages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT    NOT NULL UNIQUE,
  system_key       TEXT    UNIQUE,                 -- páginas fijas de la web (no se pueden borrar)
  title            TEXT    NOT NULL,
  summary          TEXT,
  blocks           TEXT    NOT NULL DEFAULT '[]',  -- JSON (ver shared/site.ts)
  status           TEXT    NOT NULL DEFAULT 'publicada' CHECK (status IN ('borrador', 'publicada')),
  seo_title        TEXT,
  seo_description  TEXT,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by       INTEGER REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE site_posts (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT    NOT NULL UNIQUE,
  title            TEXT    NOT NULL,
  excerpt          TEXT,
  blocks           TEXT    NOT NULL DEFAULT '[]',
  status           TEXT    NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'publicada')),
  published_at     TEXT,
  pinned           INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  tournament_id    INTEGER REFERENCES tournaments (id) ON DELETE SET NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by       INTEGER REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX idx_posts_published ON site_posts (status, published_at DESC);

CREATE TABLE site_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  title            TEXT    NOT NULL,
  kind             TEXT    NOT NULL DEFAULT 'evento' CHECK (kind IN ('cancha_abierta', 'evento', 'inscripcion', 'otro')),
  starts_on        TEXT    NOT NULL,                -- AAAA-MM-DD
  ends_on          TEXT,
  start_time       TEXT,                            -- HH:MM
  location         TEXT,
  description      TEXT,
  tournament_id    INTEGER REFERENCES tournaments (id) ON DELETE SET NULL,
  public           INTEGER NOT NULL DEFAULT 1 CHECK (public IN (0, 1)),
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by       INTEGER REFERENCES users (id) ON DELETE SET NULL,
  CHECK (ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX idx_events_date ON site_events (starts_on);

-- Datos públicos de los torneos. Por defecto NO se publican: un organizador decide qué aparece en la web.
ALTER TABLE tournaments ADD COLUMN series TEXT CHECK (series IS NULL OR series IN ('open_1000', 'challenger_500', 'satelite_100', 'master_2000', 'otro'));
ALTER TABLE tournaments ADD COLUMN public_visible INTEGER NOT NULL DEFAULT 0 CHECK (public_visible IN (0, 1));
ALTER TABLE tournaments ADD COLUMN featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1));
ALTER TABLE tournaments ADD COLUMN public_description TEXT;
ALTER TABLE tournaments ADD COLUMN prize_info TEXT;
ALTER TABLE tournaments ADD COLUMN registration_open INTEGER NOT NULL DEFAULT 0 CHECK (registration_open IN (0, 1));
CREATE INDEX idx_tournaments_public ON tournaments (public_visible, start_date);

-- Datos de la web, tal como figuran en www.padeltime.com.ar. Editables desde el panel (Publicación web).
INSERT INTO app_settings (key, value) VALUES
  ('site_tagline', 'Comunidad de pádel'),
  ('site_whatsapp', '5491124065574'),
  ('site_whatsapp_message', 'Hola! Quiero inscribirme'),
  ('site_instagram', 'padeltimeok'),
  ('site_venue_name', 'Las Vías Padel Center'),
  ('site_address', 'César Díaz 850, Belén de Escobar, Buenos Aires'),
  ('site_map_lat', '-34.347193'),
  ('site_map_lng', '-58.798778'),
  ('site_announcement_text', ''),
  ('site_announcement_url', ''),
  ('site_active_genders', 'M');

-- La caché pública se invalida ante cualquier cambio visible en la web.
CREATE TRIGGER trg_pubver_tournaments_any AFTER UPDATE ON tournaments
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_tournaments_ins AFTER INSERT ON tournaments
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_tournaments_del AFTER DELETE ON tournaments
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_teams_ins AFTER INSERT ON tournament_team_players
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_teams_del AFTER DELETE ON tournament_team_players
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;

CREATE TRIGGER trg_pubver_site_pages_insert AFTER INSERT ON site_pages
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;

CREATE TRIGGER trg_pubver_site_pages_update AFTER UPDATE ON site_pages
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;

CREATE TRIGGER trg_pubver_site_pages_delete AFTER DELETE ON site_pages
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;

CREATE TRIGGER trg_pubver_site_posts_insert AFTER INSERT ON site_posts
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;

CREATE TRIGGER trg_pubver_site_posts_update AFTER UPDATE ON site_posts
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;

CREATE TRIGGER trg_pubver_site_posts_delete AFTER DELETE ON site_posts
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;

CREATE TRIGGER trg_pubver_site_events_insert AFTER INSERT ON site_events
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;

CREATE TRIGGER trg_pubver_site_events_update AFTER UPDATE ON site_events
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;

CREATE TRIGGER trg_pubver_site_events_delete AFTER DELETE ON site_events
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;

-- Páginas fijas con el contenido actual de la web oficial.
INSERT INTO site_pages (system_key, slug, title, summary, blocks, sort_order) VALUES ('inicio', 'inicio', 'Comunidad de pádel', NULL, '[{"type": "list", "items": ["Cancha abierta", "Torneos", "Liga", "Ranking", "Premios"]}, {"type": "heading", "text": "¿De qué se trata el circuito Padel Time?"}, {"type": "steps", "items": [{"title": "Torneos largos", "text": "Partidos a tres sets, una vez por semana, grupos y finalmente Copa Oro y Plata."}, {"title": "Torneos cortos", "text": "Satélites (americanos), se definen en el día y te permiten sumar (menos que los largos)."}, {"title": "Ranking anual", "text": "Todos los torneos suman, participando y sobre todo ganando."}, {"title": "Dónde se juega", "text": "En Las Vías Padel Center, César Díaz 850, Belén de Escobar, Buenos Aires."}, {"title": "Cuándo se juega", "text": "Inicia en junio y los torneos largos se juegan días de semana por la noche y los cortos los fines de semana."}]}]', 0);
INSERT INTO site_pages (system_key, slug, title, summary, blocks, sort_order) VALUES ('liga', 'liga', 'Liga', NULL, '[{"type": "heading", "text": "¿De qué se trata el circuito Padel Time?"}, {"type": "steps", "items": [{"title": "Torneos largos", "text": "Partidos a tres sets, una vez por semana, grupos y finalmente Copa Oro y Plata."}, {"title": "Torneos cortos", "text": "Satélites (americanos), se definen en el día y te permiten sumar (menos que los largos)."}, {"title": "Ranking anual", "text": "Todos los torneos suman, participando y sobre todo ganando."}, {"title": "Dónde se juega", "text": "En Las Vías Padel Center, César Díaz 850, Belén de Escobar, Buenos Aires."}, {"title": "Cuándo se juega", "text": "Inicia en junio y los torneos largos se juegan días de semana por la noche y los cortos los fines de semana."}]}, {"type": "button", "label": "Ver el reglamento completo", "url": "/reglamentos"}]', 1);
INSERT INTO site_pages (system_key, slug, title, summary, blocks, sort_order) VALUES ('cancha_abierta', 'cancha-abierta', 'Cancha abierta', NULL, '[{"type": "heading", "text": "Jornadas de evaluación y emparejamiento"}, {"type": "paragraph", "text": "Para participar en nuestros eventos es obligatorio (sin excepciones) haber sido evaluado por nuestros veedores, para conocer tu nivel y poder ubicarte correctamente en la categoría correspondiente."}, {"type": "paragraph", "text": "Esto lo hacemos a través de las canchas abiertas, o partidos armados, que realizamos permanentemente a los largo del año."}, {"type": "paragraph", "text": "En el caso de haber sido mal categorizado por error, la administración de la liga procederá a reubicarte a la categoria que corresponda."}]', 2);
INSERT INTO site_pages (system_key, slug, title, summary, blocks, sort_order) VALUES ('premios', 'premios', 'Premios', NULL, '[{"type": "paragraph", "text": "Las finales del Master se disputarán todas el mismo día y se realizará la cena de fin de año y la entrega de premios."}]', 3);
INSERT INTO site_pages (system_key, slug, title, summary, blocks, sort_order) VALUES ('reglamentos', 'reglamentos', 'Reglamentos', NULL, '[{"type": "heading", "text": "Jornadas de evaluación y emparejamiento"}, {"type": "paragraph", "text": "Para participar en nuestros eventos es obligatorio (sin excepciones) haber sido evaluado por nuestros veedores, para conocer tu nivel y poder ubicarte correctamente en la categoría correspondiente."}, {"type": "paragraph", "text": "Esto lo hacemos a través de las canchas abiertas, o partidos armados, que realizamos permanentemente a los largo del año."}, {"type": "paragraph", "text": "En el caso de haber sido mal categorizado por error, la administración de la liga procederá a reubicarte a la categoria que corresponda."}, {"type": "heading", "text": "Open 1000"}, {"type": "paragraph", "text": "Son torneos largos, se realizan 2 por año y son abiertos (no requieren clasificación por ranking), los ganadores además de los premios suman 1000 (mil) puntos al ranking anual."}, {"type": "paragraph", "text": "Se juega a partidos completos (3 sets con tie break en 6-6 y punto de oro), uno por semana, siempre el mismo día de la semana."}, {"type": "paragraph", "text": "La etapa inicial es clasificatoria todos contra todos, en caso de ser una categoria numerosa puede dividirse en dos grupos, una vez completados esos partidos, se juega la Copa de Oro para los primeros y Copa de Plata para los restantes, a partir de esa etapa pasa a ser eliminacion directa."}, {"type": "paragraph", "text": "Días y horarios: Dependiendo de tu categoría, el día y horario que te toca jugar."}, {"type": "paragraph", "text": "Caballeros: siempre desde 21:00 en adelante. Lunes C8, Martes C5, Miércoles C7, Jueves C6."}, {"type": "heading", "text": "Challenger 500"}, {"type": "paragraph", "text": "Son torneos cortos (un mes y medio aproximadamente), se realizan 4 por año y son abiertos (no requieren clasificación por ranking), los ganadores además de los premios suman 500 (quinientos) puntos al ranking anual."}, {"type": "paragraph", "text": "Se juega a partidos completos (3 sets con tie break en 6-6 y punto de oro), uno por semana, siempre el mismo dia de la semana."}, {"type": "paragraph", "text": "La etapa inicial es clasificatoria y estará dividida en 2, 3 o 4 grupos, dependiendo la cantidad de inscriptos, los 2 primeros de cada grupo avanzaran a Copa de Oro y los restantes a Copa de plata, a partir de esa etapa pasa a ser eliminacion directa."}, {"type": "paragraph", "text": "Dias y horarios: Dependiendo de tu categoria, el dia y horario que te toca jugar."}, {"type": "paragraph", "text": "Caballeros: siempre desde 21:00 en adelante. Lunes C8, Martes C5, Miércoles C7, Jueves C6."}, {"type": "heading", "text": "Satélite 100"}, {"type": "paragraph", "text": "Son torneos americanos, partidos a un set, inician y finalizan en el día, se realizan varios por mes y son abiertos (no requieren clasificación por ranking), los ganadores además de los premios suman 100 (cien) puntos al ranking anual."}, {"type": "paragraph", "text": "Se juega con punto de oro y tie breaks en 5-5."}, {"type": "paragraph", "text": "Los días y horarios de los Satélite 100 son variables y se irán publicando oportunamente en nuestras redes sociales."}, {"type": "heading", "text": "Master Final 2000"}, {"type": "paragraph", "text": "El gran torneo final, es corto (un mes y medio aproximadamente), se juega una sola vez por año y solo se puede acceder ocupando los primeros lugares del ranking (de cada categoría), los ganadores, además de los premios, suman 2000 puntos al ranking anual."}, {"type": "paragraph", "text": "Se juega a partidos completos (3 sets con tie break en 6-6 y punto de oro), uno por semana, siempre el mismo día de la semana."}, {"type": "paragraph", "text": "La etapa inicial es clasificatoria, con cabezas de serie y ordenados por ranking (se suman los puntos de los dos integrantes de cada para pareja para determinarlo), juegan en 2 grupos de 4 todos contra todos, y según la ubicación final se determina el rival del otro grupo. El primero del grupo A vs el cuarto del grupo B y a la inversa, y los segundos contra los terceros, respectivamente."}, {"type": "paragraph", "text": "Días y horarios: Dependiendo de tu categoría, el día y horario que te toca jugar."}, {"type": "paragraph", "text": "Las finales del Master se disputarán todas el mismo día y se realizará la cena de fin de año y la entrega de premios."}, {"type": "paragraph", "text": "Las etapas anteriores (hasta semifinales incluida):"}, {"type": "paragraph", "text": "Caballeros: siempre desde 21:00 en adelante. Lunes C8, Martes C5, Miércoles C7, Jueves C6."}]', 4);
INSERT INTO site_pages (system_key, slug, title, summary, blocks, sort_order) VALUES ('contacto', 'contacto', 'Contacto e inscripciones', NULL, '[]', 5);
