-- Internal staff contact tasks (welcome call, next contact reminders).
-- Advisor/owner/supervisor/admin only — not shown to customers.

CREATE TABLE IF NOT EXISTS staff_contact_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN ('welcome_call', 'next_contact')),
  due_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS staff_contact_tasks_session_idx ON staff_contact_tasks(session_id);
CREATE INDEX IF NOT EXISTS staff_contact_tasks_due_idx ON staff_contact_tasks(due_at) WHERE completed_at IS NULL;

-- One open welcome call per session; one open next-contact task per session.
CREATE UNIQUE INDEX IF NOT EXISTS staff_contact_tasks_open_welcome_idx
  ON staff_contact_tasks(session_id)
  WHERE task_type = 'welcome_call' AND completed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS staff_contact_tasks_open_next_idx
  ON staff_contact_tasks(session_id)
  WHERE task_type = 'next_contact' AND completed_at IS NULL;

ALTER TABLE staff_contact_tasks ENABLE ROW LEVEL SECURITY;

-- Service role only (server functions use supabaseAdmin).
CREATE POLICY staff_contact_tasks_service ON staff_contact_tasks
  FOR ALL USING (false) WITH CHECK (false);
