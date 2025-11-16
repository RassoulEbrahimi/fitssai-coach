-- Insert first admin user
-- This will only succeed if the user exists in auth.users
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::app_role
FROM auth.users
WHERE email = 'mormoj33@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;