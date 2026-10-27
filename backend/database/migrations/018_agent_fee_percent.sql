-- 018_agent_fee_percent.sql
-- The agreed management-fee percentage a property's agent earns, as a share
-- of rent collected. Only meaningful while plots.agent_id is set; NULL = no
-- fee agreed. The owner statement uses it to show the agent fee deduction.
ALTER TABLE plots
  ADD COLUMN IF NOT EXISTS agent_fee_percent DECIMAL(5,2)
  CHECK (agent_fee_percent IS NULL OR (agent_fee_percent >= 0 AND agent_fee_percent <= 100));
