-- Agents are now assigned PER PROPERTY (plots.agent_id), not per landlord.
-- A landlord can have one property run by an agent and the rest self-managed.
--
-- Until now the effective agent of a property was its landlord's agent
-- (users.agent_id). This copies that onto each property so nothing changes
-- on day one: a property whose landlord had an agent keeps that agent; a
-- property whose landlord had none becomes self-managed (agent_id NULL).
-- users.agent_id is left in place but is no longer read by the app.
UPDATE plots p
SET agent_id = u.agent_id
FROM users u
WHERE p.user_id = u.id
  AND p.agent_id IS DISTINCT FROM u.agent_id;
