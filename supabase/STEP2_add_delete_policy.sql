-- Run this in your Supabase SQL Editor to allow clearing the admin logs

-- Add DELETE policy for admin_logs
CREATE POLICY "Enable delete for all" ON admin_logs FOR DELETE USING (true);
