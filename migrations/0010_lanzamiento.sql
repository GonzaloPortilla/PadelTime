-- Padel Time · Migración 0010 · Preparación del lanzamiento (Fase 11)
--
-- Sólo agrega estructuras y datos de configuración (no toca jugadores, torneos, puntos ni contenidos):
--  1. tournaments.result_files: archivos de resultados de una categoría (imágenes o PDF de la biblioteca).
--     Sirve para los torneos históricos de la web anterior, donde fixtures, tablas y copas sólo existen como
--     imágenes: se conservan como archivo, sin inventar datos estructurados.
--  2. site_redirects: redirecciones 301 desde las direcciones de la web anterior (Google Sites) hacia las nuevas,
--     para no perder visitas ni posicionamiento al cambiar el dominio. Editables desde el panel.

ALTER TABLE tournaments ADD COLUMN result_files TEXT NOT NULL DEFAULT '[]';  -- JSON [{ "mediaId": "...", "label": "Fixture" }]

CREATE TABLE site_redirects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  from_path   TEXT    NOT NULL UNIQUE,            -- dirección anterior, decodificada y sin barra final (p. ej. /página-principal)
  to_path     TEXT    NOT NULL,                   -- dirección nueva (siempre interna: empieza con /)
  prefix      INTEGER NOT NULL DEFAULT 0 CHECK (prefix IN (0, 1)),  -- 1 = también todas las subpáginas
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by  INTEGER REFERENCES users (id) ON DELETE SET NULL
);

-- Secciones de la web anterior (inventario de la Fase 6, docs/web-anterior/inventario-paginas.csv).
-- /reglamentos mantiene la misma dirección en la web nueva: no necesita redirección.
INSERT INTO site_redirects (from_path, to_path, prefix, note) VALUES
  ('/página-principal', '/', 0, 'Portada de Google Sites'),
  ('/calendario-2026', '/calendario', 1, 'Calendario 2026 (imágenes)'),
  ('/rankings-2026', '/rankings', 1, 'Rankings 2026 (imágenes por categoría)'),
  ('/rankings-2025', '/rankings', 1, 'Rankings 2025 (imágenes por categoría)'),
  ('/ranking-general', '/rankings', 1, 'Página vacía en la web anterior'),
  ('/paris-major-2000', '/torneos?estado=historial', 1, 'Torneo: cambiar por la página del torneo cuando se cargue'),
  ('/p1-buenos-aires', '/torneos?estado=historial', 1, 'Torneo: cambiar por la página del torneo cuando se cargue'),
  ('/qatar-major-2000', '/torneos?estado=historial', 1, 'Torneo: cambiar por la página del torneo cuando se cargue'),
  ('/p1-mallorca-1000', '/torneos?estado=historial', 1, 'Torneo: cambiar por la página del torneo cuando se cargue'),
  ('/p1-australia-1000', '/torneos?estado=historial', 1, 'Torneo: cambiar por la página del torneo cuando se cargue'),
  ('/master-final-2025', '/torneos?estado=historial', 1, 'Torneo: cambiar por la página del torneo cuando se cargue'),
  ('/paris-open-1000-2025', '/torneos?estado=historial', 1, 'Torneo: cambiar por la página del torneo cuando se cargue'),
  ('/challenger-500-2025', '/torneos?estado=historial', 1, 'Torneo: cambiar por la página del torneo cuando se cargue'),
  ('/satélites-1000-2025', '/torneos?estado=historial', 1, 'Satélites 2025: cambiar por la página del torneo cuando se cargue'),
  ('/winter-time-cup-2025', '/torneos?estado=historial', 1, 'Torneo: cambiar por la página del torneo cuando se cargue');

-- La web pública guarda en caché las respuestas (incluidas las 404): un cambio de redirecciones la invalida.
CREATE TRIGGER trg_pubver_redirects_ins AFTER INSERT ON site_redirects
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_redirects_upd AFTER UPDATE ON site_redirects
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
CREATE TRIGGER trg_pubver_redirects_del AFTER DELETE ON site_redirects
BEGIN UPDATE app_settings SET value = CAST(value AS INTEGER) + 1 WHERE key = 'public_version'; END;
