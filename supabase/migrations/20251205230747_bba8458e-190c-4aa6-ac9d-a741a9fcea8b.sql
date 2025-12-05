CREATE POLICY "Only admins can update roles" 
ON user_roles 
FOR UPDATE 
USING (has_role(auth.uid(), 'admin'::app_role));