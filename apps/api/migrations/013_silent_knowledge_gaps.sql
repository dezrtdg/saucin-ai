ALTER TABLE knowledge_gaps
  ADD COLUMN IF NOT EXISTS example_questions TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

UPDATE knowledge_gaps
   SET example_questions = ARRAY[sample_question]
 WHERE cardinality(example_questions) = 0
   AND btrim(sample_question) <> '';

CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_example_questions
  ON knowledge_gaps USING GIN (example_questions);
