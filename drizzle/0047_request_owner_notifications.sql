CREATE FUNCTION via_notify_request_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_row jsonb := to_jsonb(NEW);
  previous_row jsonb;
  current_status text;
  owner_employee uuid;
  owner_user uuid;
BEGIN
  current_status := current_row->>TG_ARGV[0];
  IF current_status IS NULL OR current_status='Draft' OR current_row->>'archived_at' IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' THEN
    previous_row := to_jsonb(OLD);
    IF previous_row->>TG_ARGV[0] IS NOT DISTINCT FROM current_status THEN RETURN NEW; END IF;
  END IF;
  owner_employee := (current_row->>TG_ARGV[1])::uuid;
  SELECT id INTO owner_user FROM users WHERE organisation_id=NEW.organisation_id AND employee_id=owner_employee AND status='Active' AND archived_at IS NULL;
  IF owner_user IS NULL THEN RETURN NEW; END IF;
  INSERT INTO notifications(organisation_id,recipient_user_id,type,title,message,priority,status,deduplication_key,link,created_by,updated_by)
  VALUES(NEW.organisation_id,owner_user,'workflow.request_update',TG_ARGV[2] || ' request update',
    CASE WHEN TG_OP='INSERT' THEN 'Your record has been received. Open My Requests to see its current status and next step.' ELSE 'Your request status has changed. Open My Requests to see the decision and next step.' END,
    'Normal','Unread','workflow-status:' || TG_TABLE_NAME || ':' || NEW.id || ':' || txid_current() || ':' || current_status,
    jsonb_build_object('entityType',TG_ARGV[3],'entityId',NEW.id,'path','/staff/requests?view=my'),NEW.created_by,NEW.updated_by)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER leave_request_owner_notice AFTER INSERT OR UPDATE ON leave_requests FOR EACH ROW EXECUTE FUNCTION via_notify_request_owner('status','employee_id','Leave','leave-request');
--> statement-breakpoint
CREATE TRIGGER timesheet_owner_notice AFTER INSERT OR UPDATE ON timesheets FOR EACH ROW EXECUTE FUNCTION via_notify_request_owner('status','employee_id','Timesheet','timesheet');
--> statement-breakpoint
CREATE TRIGGER overtime_owner_notice AFTER INSERT OR UPDATE ON overtime_claims FOR EACH ROW EXECUTE FUNCTION via_notify_request_owner('status','employee_id','Overtime','overtime-claim');
--> statement-breakpoint
CREATE TRIGGER correction_owner_notice AFTER INSERT OR UPDATE ON attendance_corrections FOR EACH ROW EXECUTE FUNCTION via_notify_request_owner('status','employee_id','Attendance correction','attendance-correction');
--> statement-breakpoint
CREATE TRIGGER visit_owner_notice AFTER INSERT OR UPDATE ON site_visit_requests FOR EACH ROW EXECUTE FUNCTION via_notify_request_owner('status','employee_id','Visit','site-visit-request');
--> statement-breakpoint
CREATE TRIGGER travel_owner_notice AFTER INSERT OR UPDATE ON travel_requests FOR EACH ROW EXECUTE FUNCTION via_notify_request_owner('status','employee_id','Travel','travel-request');
--> statement-breakpoint
CREATE TRIGGER training_request_owner_notice AFTER INSERT OR UPDATE ON training_requests FOR EACH ROW EXECUTE FUNCTION via_notify_request_owner('status','employee_id','Training','training-request');
--> statement-breakpoint
CREATE TRIGGER profile_request_owner_notice AFTER INSERT OR UPDATE ON profile_change_requests FOR EACH ROW EXECUTE FUNCTION via_notify_request_owner('status','employee_id','Profile','profile-change-request');
--> statement-breakpoint
CREATE TRIGGER goal_request_owner_notice AFTER INSERT OR UPDATE ON employee_goals FOR EACH ROW EXECUTE FUNCTION via_notify_request_owner('status','employee_id','Objective','employee-goal');
--> statement-breakpoint
CREATE TRIGGER internal_application_owner_notice AFTER INSERT OR UPDATE ON candidate_applications FOR EACH ROW EXECUTE FUNCTION via_notify_request_owner('status','internal_applicant_employee_id','Application','candidate-application');
--> statement-breakpoint
CREATE TRIGGER referral_owner_notice AFTER INSERT OR UPDATE ON candidate_recommendations FOR EACH ROW EXECUTE FUNCTION via_notify_request_owner('review_status','recommender_employee_id','Referral','candidate-recommendation');
