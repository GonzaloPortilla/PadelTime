export function auditStmt(
  db: D1Database,
  userId: number | null,
  action: string,
  entity: string,
  entityId: number | null,
  summary: string,
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO audit_log (user_id, action, entity, entity_id, summary) VALUES (?, ?, ?, ?, ?)")
    .bind(userId, action, entity, entityId, summary.slice(0, 300));
}
