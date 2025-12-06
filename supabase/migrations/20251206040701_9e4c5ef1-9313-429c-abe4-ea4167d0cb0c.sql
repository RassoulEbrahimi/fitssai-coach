-- Create exercises table for storing exercise library
CREATE TABLE public.exercises (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  target_muscle TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read exercises (shared library)
CREATE POLICY "Authenticated users can view exercises"
ON public.exercises
FOR SELECT
TO authenticated
USING (true);

-- Insert the 20 German exercises with proper categorization
INSERT INTO public.exercises (name, target_muscle, category) VALUES
  ('Butterfly Reverse', 'Shoulders', 'Machine'),
  ('Enges Rudern am Kabelzug', 'Back', 'Cable'),
  ('Breites Rudern am Kabelzug', 'Back', 'Cable'),
  ('Latzug am Kabelzug', 'Back', 'Cable'),
  ('Beinbeuger sitzend Maschine', 'Legs', 'Machine'),
  ('Adduktionsmaschine', 'Legs', 'Machine'),
  ('Bizepscurl', 'Biceps', 'Dumbbell'),
  ('Bizepscurls Hammergriff Kurzhantel', 'Biceps', 'Dumbbell'),
  ('Crunch Kabelzug', 'Abs', 'Cable'),
  ('Hyperextension', 'Back', 'Machine'),
  ('Bankdrücken schräg Multipresse', 'Chest', 'Machine'),
  ('Butterfly', 'Chest', 'Machine'),
  ('Flys stehend Kabelzug', 'Chest', 'Cable'),
  ('Seitheben Kurzhantel', 'Shoulders', 'Dumbbell'),
  ('Schulterpresse', 'Shoulders', 'Machine'),
  ('Trizepsstrecken überkopf Kabelzug', 'Triceps', 'Cable'),
  ('Trizepsstrecken Kabelzug Kordel', 'Triceps', 'Cable'),
  ('Beinpresse 45° Plate Loaded', 'Legs', 'Machine'),
  ('Beinstrecker', 'Legs', 'Machine'),
  ('Rückenstrecker 45 Grad', 'Back', 'Machine');