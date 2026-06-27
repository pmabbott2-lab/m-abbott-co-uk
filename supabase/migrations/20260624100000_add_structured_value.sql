-- Typed facts extracted from free-text answers (income, deposit, postcode, etc.)
ALTER TABLE public.interview_answers
  ADD COLUMN IF NOT EXISTS structured_value jsonb DEFAULT '{}'::jsonb;
