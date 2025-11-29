
-- Migration to increase decimal precision for weights
-- Supports high precision like 3.1818181818...

ALTER TABLE assessments 
ALTER COLUMN weight TYPE DECIMAL(20, 10),
ALTER COLUMN total_weight TYPE DECIMAL(20, 10);

