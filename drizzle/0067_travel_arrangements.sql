ALTER TYPE system_role_code ADD VALUE IF NOT EXISTS 'Travel Admin';
--> statement-breakpoint
ALTER TABLE travel_requests ADD COLUMN participants jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE travel_requests ADD COLUMN bookings jsonb NOT NULL DEFAULT '[]'::jsonb;
