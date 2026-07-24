-- Create app_settings table
CREATE TABLE IF NOT EXISTS public.app_settings (
    id integer PRIMARY KEY DEFAULT 1,
    allow_everyone boolean NOT NULL DEFAULT true,
    CONSTRAINT single_row CHECK (id = 1)
);

-- Insert the default row if it doesn't exist
INSERT INTO public.app_settings (id, allow_everyone)
VALUES (1, true)
ON CONFLICT (id) DO NOTHING;

-- Create authorized_users table
CREATE TABLE IF NOT EXISTS public.authorized_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text UNIQUE NOT NULL,
    added_by text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS (Row Level Security)
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.authorized_users ENABLE ROW LEVEL SECURITY;

-- Note: In this project architecture, the backend connects using the SERVICE_ROLE key,
-- bypassing RLS. However, it's good practice to secure the public endpoints.

DROP POLICY IF EXISTS "Allow service role full access" ON public.app_settings;
CREATE POLICY "Allow service role full access" ON public.app_settings USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow service role full access" ON public.authorized_users;
CREATE POLICY "Allow service role full access" ON public.authorized_users USING (true) WITH CHECK (true);
