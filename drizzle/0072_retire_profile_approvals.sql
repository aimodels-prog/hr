-- Keep the old requests as history, without applying unreviewed changes.
-- Routine edits now save directly; identity corrections are verified with documents.
UPDATE profile_change_requests
SET archived_at = now(), updated_at = now(), record_version = record_version + 1,
    review_notes = coalesce(review_notes || E'\n', '') ||
      'Profile approvals retired. Save contact details directly; identity corrections are verified with a passport or ID.'
WHERE status = 'Pending' AND archived_at IS NULL;
--> statement-breakpoint
UPDATE notifications
SET status = 'Dismissed', dismissed_at = now(), updated_at = now(), record_version = record_version + 1
WHERE type IN ('profile.review-requested', 'profile.change-request')
  AND status <> 'Dismissed' AND archived_at IS NULL;
