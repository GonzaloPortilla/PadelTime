-- Padel Time · Migración 0006 · Gestor de contenidos (Fase 8)
--
-- Sólo agrega estructura y conserva todo el contenido existente:
--  * site_pages y site_posts se reconstruyen (SQLite no permite cambiar un CHECK) para sumar el estado
--    'archivada', el borrador pendiente (draft), la versión (control de edición simultánea) y quién publicó.
--    Sus filas se copian tal cual.
--  * site_revisions: historial de cambios de páginas y novedades (cada guardado y publicación).
--  * media: datos de imágenes y documentos. El archivo en sí se guarda en Workers KV, nunca en D1.
--  * site_sponsors: patrocinadores (logo de la biblioteca de medios, enlace, orden, visibilidad).
--  * site_events: versión y autor de la última modificación.
--  * Inicio pasa a estar compuesto por bloques (banner, secciones y su orden), sumando los bloques actuales.

PRAGMA defer_foreign_keys = true;

-- ───────────── Multimedia ─────────────
CREATE TABLE media (
  id           TEXT    PRIMARY KEY,                -- UUID; también es la clave del archivo en KV
  kind         TEXT    NOT NULL CHECK (kind IN ('imagen', 'documento')),
  mime         TEXT    NOT NULL,
  bytes        INTEGER NOT NULL CHECK (bytes > 0),
  width        INTEGER,
  height       INTEGER,
  filename     TEXT    NOT NULL,
  title        TEXT    NOT NULL,
  alt          TEXT,
  sha256       TEXT    UNIQUE,                     -- evita subir dos veces el mismo archivo
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by   INTEGER REFERENCES users (id) ON DELETE SET NULL,
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by   INTEGER REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX idx_media_created ON media (created_at DESC);

-- ───────────── Páginas ─────────────
CREATE TABLE site_pages_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT    NOT NULL UNIQUE,
  system_key       TEXT    UNIQUE,
  title            TEXT    NOT NULL,                 -- versión publicada
  summary          TEXT,
  blocks           TEXT    NOT NULL DEFAULT '[]',
  seo_title        TEXT,
  seo_description  TEXT,
  status           TEXT    NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'publicada', 'archivada')),
  draft            TEXT,                             -- cambios guardados sin publicar (JSON) o NULL
  version          INTEGER NOT NULL DEFAULT 1,       -- se incrementa en cada guardado
  sort_order       INTEGER NOT NULL DEFAULT 0,
  published_at     TEXT,
  published_by     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by       INTEGER REFERENCES users (id) ON DELETE SET NULL
);
INSERT INTO site_pages_new (id, slug, system_key, title, summary, blocks, seo_title, seo_description, status, sort_order, published_at, created_at, updated_at, updated_by)
  SELECT id, slug, system_key, title, summary, blocks, seo_title, seo_description, status, sort_order,
         CASE WHEN status = 'publicada' THEN updated_at END, created_at, updated_at, updated_by
    FROM site_pages;
DROP TABLE site_pages;
ALTER TABLE site_pages_new RENAME TO site_pages;

-- ───────────── Novedades ─────────────
CREATE TABLE site_posts_new (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  slug             TEXT    NOT NULL UNIQUE,
  title            TEXT    NOT NULL,
  excerpt          TEXT,
  cover_media_id   TEXT    REFERENCES media (id) ON DELETE SET NULL,
  blocks           TEXT    NOT NULL DEFAULT '[]',
  status           TEXT    NOT NULL DEFAULT 'borrador' CHECK (status IN ('borrador', 'publicada', 'archivada')),
  draft            TEXT,
  version          INTEGER NOT NULL DEFAULT 1,
  published_at     TEXT,
  published_by     INTEGER REFERENCES users (id) ON DELETE SET NULL,
  pinned           INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  tournament_id    INTEGER REFERENCES tournaments (id) ON DELETE SET NULL,
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by       INTEGER REFERENCES users (id) ON DELETE SET NULL,
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by       INTEGER REFERENCES users (id) ON DELETE SET NULL
);
INSERT INTO site_posts_new (id, slug, title, excerpt, blocks, status, published_at, pinned, tournament_id, created_at, created_by, updated_at)
  SELECT id, slug, title, excerpt, blocks, status, published_at, pinned, tournament_id, created_at, created_by, updated_at FROM site_posts;
DROP TABLE site_posts;
ALTER TABLE site_posts_new RENAME TO site_posts;
CREATE INDEX idx_posts_published ON site_posts (status, published_at DESC);

-- ───────────── Historial ─────────────
CREATE TABLE site_revisions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity      TEXT    NOT NULL CHECK (entity IN ('pagina', 'novedad')),
  entity_id   INTEGER NOT NULL,
  version     INTEGER NOT NULL,
  action      TEXT    NOT NULL CHECK (action IN ('borrador', 'publicacion', 'archivo', 'desarchivo', 'descarte', 'restauracion', 'creacion')),
  snapshot    TEXT    NOT NULL,                     -- contenido completo en ese momento (JSON)
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_by  INTEGER REFERENCES users (id) ON DELETE SET NULL
);
CREATE INDEX idx_revisions_entity ON site_revisions (entity, entity_id, id DESC);

-- ───────────── Patrocinadores ─────────────
CREATE TABLE site_sponsors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  media_id    TEXT    NOT NULL REFERENCES media (id) ON DELETE RESTRICT,
  url         TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  version     INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by  INTEGER REFERENCES users (id) ON DELETE SET NULL
);

-- ───────────── Eventos del calendario ─────────────
ALTER TABLE site_events ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE site_events ADD COLUMN updated_at TEXT;
ALTER TABLE site_events ADD COLUMN updated_by INTEGER REFERENCES users (id) ON DELETE SET NULL;

-- ───────────── Datos de la web ─────────────
INSERT INTO app_settings (key, value) VALUES
  ('site_announcement_until', ''),      -- vigencia del aviso destacado (AAAA-MM-DD, vacío = sin vencimiento)
  ('site_venue_media_id', ''),          -- foto de la sede (vacío = foto actual de la web oficial)
  ('site_settings_version', '1');       -- control de edición simultánea de los datos de la web

-- ───────────── Páginas fijas nuevas: introducción de cada sección ─────────────
INSERT INTO site_pages (system_key, slug, title, summary, blocks, status, sort_order, published_at) VALUES ('torneos', 'torneos', 'Torneos', 'Open, Challenger, Satélites y Master: fechas, categorías, resultados e inscripción.', '[]', 'publicada', 10, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO site_pages (system_key, slug, title, summary, blocks, status, sort_order, published_at) VALUES ('rankings', 'rankings', 'Rankings', 'Elegí la temporada y la categoría. Los puntos se actualizan en cuanto se acredita cada torneo.', '[]', 'publicada', 11, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO site_pages (system_key, slug, title, summary, blocks, status, sort_order, published_at) VALUES ('calendario', 'calendario', 'Calendario', 'Torneos y eventos del circuito.', '[]', 'publicada', 12, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
INSERT INTO site_pages (system_key, slug, title, summary, blocks, status, sort_order, published_at) VALUES ('novedades', 'novedades', 'Novedades', NULL, '[]', 'publicada', 13, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ───────────── Inicio por bloques: banner + bloques actuales + secciones ─────────────
-- Sólo si todavía no tiene banner (no pisa ediciones). Se conservan sus bloques actuales en el medio.
UPDATE site_pages
   SET blocks = json('[' || '{"type": "hero", "title": "Padel Time", "subtitle": "Comunidad de pádel", "mediaId": null, "buttons": [{"label": "Inscribite por WhatsApp", "url": "whatsapp"}, {"label": "Ver torneos", "url": "/torneos"}, {"label": "Rankings", "url": "/rankings"}]}' || CASE WHEN blocks NOT IN ('[]', '') THEN ',' || substr(blocks, 2, length(blocks) - 2) ELSE '' END || ',' || '{"type": "section", "kind": "featured_tournament", "title": "Próximo torneo destacado", "tournamentId": null},{"type": "section", "kind": "in_progress", "title": "Torneos en curso"},{"type": "section", "kind": "upcoming", "title": "Próximos torneos"},{"type": "section", "kind": "featured", "title": "Torneos destacados"},{"type": "section", "kind": "news", "title": "Últimas novedades"},{"type": "section", "kind": "rankings", "title": "Rankings"},{"type": "section", "kind": "sponsors", "title": "Patrocinadores"},{"type": "section", "kind": "venue", "title": "Dónde jugamos"}' || ']')
 WHERE system_key = 'inicio' AND blocks NOT LIKE '%"type": "hero"%' AND blocks NOT LIKE '%"type":"hero"%';

-- La lista "Cancha abierta · Torneos · Liga…" del inicio se muestra como etiquetas: se deja explícito.
UPDATE site_pages SET blocks = json_set(blocks, '$[1].style', 'pills')
 WHERE system_key = 'inicio' AND json_extract(blocks, '$[1].type') = 'list' AND json_extract(blocks, '$[1].style') IS NULL;

-- ───────────── Caché pública ─────────────
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
CREATE TRIGGER trg_pubver_site_sponsors_insert AFTER INSERT ON site_sponsors
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_site_sponsors_update AFTER UPDATE ON site_sponsors
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_site_sponsors_delete AFTER DELETE ON site_sponsors
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_media_update AFTER UPDATE ON media
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_media_delete AFTER DELETE ON media
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
