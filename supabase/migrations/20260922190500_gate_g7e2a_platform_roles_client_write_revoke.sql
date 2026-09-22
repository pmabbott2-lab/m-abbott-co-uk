-- Gate G7E-2A follow-up: defense-in-depth revoke of client write grants on platform_roles.
-- RLS already denies INSERT/UPDATE/DELETE (SELECT-only policy). This removes overly broad GRANTs.

REVOKE ALL ON TABLE public.platform_roles FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.platform_roles FROM authenticated;
GRANT SELECT ON TABLE public.platform_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.platform_roles TO service_role;
