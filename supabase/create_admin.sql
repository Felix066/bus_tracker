-- Add or update the admin user with username 'admin' and password 'password123'
INSERT INTO admins (username, password_hash) 
VALUES ('admin', crypt('password123', gen_salt('bf')))
ON CONFLICT (username) DO UPDATE 
SET password_hash = crypt('password123', gen_salt('bf'));
