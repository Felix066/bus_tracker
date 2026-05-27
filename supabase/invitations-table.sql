-- Create invitations table
CREATE TABLE IF NOT EXISTS invitations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL, -- 'student', 'driver', 'faculty', 'admin'
  college_id VARCHAR(100),
  token VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT false,
  used_at TIMESTAMP,
  created_by UUID REFERENCES auth.users(id)
);

-- Create index for token lookup
CREATE INDEX idx_invitations_token ON invitations(token);
CREATE INDEX idx_invitations_email ON invitations(email);
CREATE INDEX idx_invitations_used ON invitations(used);

-- Enable RLS
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;

-- Policy: Anyone can check if their token is valid (before signup)
CREATE POLICY "Check invitation token" ON invitations
  FOR SELECT
  USING (true);

-- Policy: Only admins can create invitations
CREATE POLICY "Create invitations" ON invitations
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated' AND 
    EXISTS (
      SELECT 1 FROM auth.users 
      WHERE id = auth.uid() 
      AND raw_user_meta_data->>'role' = 'admin'
    ));
