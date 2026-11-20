declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    RESTORE_DB: D1Database;
  }
  interface GlobalProps {
    mainModule: typeof import("../worker/index");
  }
}
