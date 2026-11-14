-- Additive, backward-compatible resume position per participant and survey version.
-- Existing answers and submitted timestamps are never changed.
ALTER TABLE public.survey_responses
  ADD COLUMN IF NOT EXISTS last_section_id smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_page_idx smallint NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'survey_responses_last_section_id_range') THEN
    ALTER TABLE public.survey_responses
      ADD CONSTRAINT survey_responses_last_section_id_range CHECK (last_section_id BETWEEN 1 AND 7);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'survey_responses_last_page_idx_range') THEN
    ALTER TABLE public.survey_responses
      ADD CONSTRAINT survey_responses_last_page_idx_range CHECK (last_page_idx BETWEEN 0 AND 30);
  END IF;
END $$;
