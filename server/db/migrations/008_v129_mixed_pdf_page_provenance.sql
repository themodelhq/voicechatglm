-- v1.2.9: retain truthful same-page native-plus-raster OCR provenance and redaction exclusions.
-- v1.2.8's shared processor can safely exclude a page after secret-redaction review; its
-- original constraint did not permit that truthful state. Mixed pages now have a distinct,
-- ordered extraction method rather than mislabelling the retained native+OCR result as OCR-only.
ALTER TABLE knowledge_source_pages
  DROP CONSTRAINT IF EXISTS knowledge_source_pages_extraction_method_check;
ALTER TABLE knowledge_source_pages
  ADD CONSTRAINT knowledge_source_pages_extraction_method_check
  CHECK (extraction_method IN ('native_text', 'ocr', 'mixed'));

ALTER TABLE knowledge_source_pages
  DROP CONSTRAINT IF EXISTS knowledge_source_pages_processing_status_check;
ALTER TABLE knowledge_source_pages
  ADD CONSTRAINT knowledge_source_pages_processing_status_check
  CHECK (processing_status IN ('completed', 'partial', 'failed', 'excluded'));
