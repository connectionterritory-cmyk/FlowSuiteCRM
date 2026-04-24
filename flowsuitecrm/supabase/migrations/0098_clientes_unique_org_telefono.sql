-- Step 1: Remove duplicates keeping highest id per (org_id, telefono)
DELETE FROM clientes a
USING clientes b
WHERE a.org_id = b.org_id
  AND a.telefono = b.telefono
  AND a.telefono IS NOT NULL
  AND a.id < b.id;

-- Step 2: Add unique constraint
ALTER TABLE clientes
  ADD CONSTRAINT clientes_org_telefono_uidx UNIQUE (org_id, telefono);
