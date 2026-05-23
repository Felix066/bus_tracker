// Replace with your actual Supabase URL and Anon Key
const SUPABASE_URL = 'https://qlzqymdeguhzlxnfawiq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFsenF5bWRlZ3Voemx4bmZhd2lxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0NjQ2NTUsImV4cCI6MjA5MTA0MDY1NX0.hK2Vnpn9nXu2oRA0N--sFS4zaquvGxKIRjPW4Q90rj4';

window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
