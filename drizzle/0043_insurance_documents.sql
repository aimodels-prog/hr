ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'insurance_card';
ALTER TYPE document_type ADD VALUE IF NOT EXISTS 'insurance_benefits';
ALTER TABLE employee_documents ADD CONSTRAINT insurance_documents_private CHECK (type::text NOT IN ('insurance_card','insurance_benefits') OR visibility='Restricted');
