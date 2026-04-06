// Replace with your actual Supabase URL and Anon Key
const SUPABASE_URL = 'https://your-project-url.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key';

window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
