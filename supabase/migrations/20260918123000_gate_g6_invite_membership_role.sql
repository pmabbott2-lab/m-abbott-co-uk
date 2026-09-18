-- Gate G6: bind staff invitations to an explicit tenant membership role.
-- Does NOT create platform roles or Super Owner.
-- Fixes prior ambiguity where admin invites mapped to membership role 'owner'.

ALTER TABLE public.staff_invitations
  ADD COLUMN IF NOT EXISTS membership_role public.tenant_member_role;

COMMENT ON COLUMN public.staff_invitations.membership_role IS
  'G6: intended tenant_membership.role on accept. Independent of legacy app_role column. Owner invites use owner; General Admin uses general; adviser invites use adviser.';

-- Backfill open invites: admin → general (never auto-owner); advisor → adviser; introducer → introducer.
UPDATE public.staff_invitations
SET membership_role = CASE
  WHEN role = 'admin'::public.app_role THEN 'general'::public.tenant_member_role
  WHEN role = 'advisor'::public.app_role THEN 'adviser'::public.tenant_member_role
  WHEN role = 'introducer'::public.app_role THEN 'introducer'::public.tenant_member_role
  ELSE membership_role
END
WHERE membership_role IS NULL
  AND used_at IS NULL;

-- Used invites: leave NULL (historical); acceptance already applied.

ALTER TABLE public.staff_invitations
  DROP CONSTRAINT IF EXISTS staff_invitations_membership_role_owner_chk;

-- Owner membership invites must use app_role admin (no app_role 'owner').
ALTER TABLE public.staff_invitations
  ADD CONSTRAINT staff_invitations_membership_role_owner_chk
  CHECK (
    membership_role IS NULL
    OR membership_role <> 'owner'::public.tenant_member_role
    OR role = 'admin'::public.app_role
  );
