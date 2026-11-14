-- Additive migration: persist navigation separately from validated answers.
-- No existing response, submission or environment version is changed.
ALTER TABLE public.survey_responses
  ADD COLUMN IF NOT EXISTS last_section_id smallint NOT NULL DEFAULT 1;

ALTER TABLE public.survey_responses
  ADD CONSTRAINT survey_responses_last_section_id_range
  CHECK (last_section_id BETWEEN 1 AND 7);
