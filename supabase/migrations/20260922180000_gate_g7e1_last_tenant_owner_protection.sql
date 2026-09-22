-- Gate G7E-1: last active Tenant Owner protection on tenant_memberships.
-- Applies only while the tenant status is active.
-- Does NOT insert memberships, platform_roles, or Auth users.

CREATE OR REPLACE FUNCTION public.prevent_last_tenant_owner_loss()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_old_is_active_owner boolean;
  v_new_is_active_owner boolean;
  remaining integer;
  tenant_is_active boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id;
    v_old_is_active_owner :=
      OLD.role = 'owner'::public.tenant_member_role
      AND OLD.active IS TRUE;
    IF NOT v_old_is_active_owner THEN
      RETURN OLD;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    v_tenant_id := NEW.tenant_id;
    v_old_is_active_owner :=
      OLD.role = 'owner'::public.tenant_member_role
      AND OLD.active IS TRUE;
    v_new_is_active_owner :=
      NEW.role = 'owner'::public.tenant_member_role
      AND NEW.active IS TRUE;
    -- Only care when an active Owner ceases to be an active Owner.
    IF NOT v_old_is_active_owner OR v_new_is_active_owner THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Lock the tenant row so concurrent last-Owner removals serialize.
  -- Without this, two sessions each removing one of two Owners can both
  -- see remaining=1 and leave the tenant with zero active Owners.
  SELECT (t.status = 'active'::public.tenant_status)
    INTO tenant_is_active
  FROM public.tenants t
  WHERE t.id = v_tenant_id
  FOR UPDATE;

  -- Non-active / missing tenants are not protected by this rule.
  IF tenant_is_active IS DISTINCT FROM TRUE THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COUNT(*)::integer
    INTO remaining
  FROM public.tenant_memberships tm
  WHERE tm.tenant_id = v_tenant_id
    AND tm.role = 'owner'::public.tenant_member_role
    AND tm.active IS TRUE
    AND tm.id IS DISTINCT FROM OLD.id;

  IF remaining < 1 THEN
    RAISE EXCEPTION 'last_tenant_owner_protected'
      USING ERRCODE = 'restrict_violation',
        HINT = 'This company must have at least one active Owner. Add another Owner before removing this one.';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION public.prevent_last_tenant_owner_loss() IS
  'G7E-1: block DELETE / demote / deactivate of the final active Owner on an active tenant.';

DROP TRIGGER IF EXISTS tenant_memberships_prevent_last_owner ON public.tenant_memberships;
CREATE TRIGGER tenant_memberships_prevent_last_owner
  BEFORE DELETE OR UPDATE OF role, active ON public.tenant_memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_tenant_owner_loss();

REVOKE ALL ON FUNCTION public.prevent_last_tenant_owner_loss() FROM PUBLIC, anon;
