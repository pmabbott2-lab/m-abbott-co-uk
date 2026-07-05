-- Optional: customer address on profiles (used on customer hub + contact updates)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS address text;
