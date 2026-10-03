-- Run once. Gives every plot its own agent (instead of inheriting the owner's).
ALTER TABLE plots
  ADD COLUMN IF NOT EXISTS agent_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- Optional starting point: give existing plots the agent their landlord already has,
-- so nothing looks unassigned after the change. Skip if you'd rather start blank.
UPDATE plots p
SET agent_id = u.agent_id
FROM users u
WHERE p.user_id = u.id
  AND u.agent_id IS NOT NULL
  AND p.agent_id IS NULL;
