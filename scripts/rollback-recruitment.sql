-- Backward-compatible entry point. H3.3 is now one ordered module migration,
-- so recruitment cannot be rolled back independently without breaking FKs.
\ir rollback-h3-3.sql
