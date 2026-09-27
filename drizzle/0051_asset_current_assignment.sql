-- Preserve every historical assignment; fail safely if existing data needs review.
CREATE UNIQUE INDEX "asset_assignments_one_current_unique"
  ON "asset_assignments" ("asset_id")
  WHERE "status" = 'Assigned' AND "archived_at" IS NULL;
