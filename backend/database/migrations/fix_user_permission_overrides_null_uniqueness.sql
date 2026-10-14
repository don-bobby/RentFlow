-- Follow-up to add_user_permission_overrides.sql — fixes a real bug in that
-- migration's uniqueness rule.
--
-- THE BUG: standard SQL (and Postgres) treats two NULLs as never equal to
-- each other for the purposes of a UNIQUE constraint. A "global" override
-- (one that applies to every property a user can see) is stored with
-- plot_id = NULL — so the UNIQUE(user_id, plot_id, permission) constraint
-- from the first migration does NOT actually stop two global overrides for
-- the same user + permission from both existing at once. Worst case: one
-- row says "grant payments.delete" and another says "revoke payments.delete"
-- for the same user, globally, with nothing stopping both from existing and
-- no defined way to know which one should win.
--
-- Verified locally: a plain UNIQUE(user_id, plot_id, permission) let two
-- identical (user_id, NULL, permission) rows insert without error. Replacing
-- it with a unique index on (user_id, COALESCE(plot_id, 0), permission)
-- treats "no property" consistently and blocks the duplicate, confirmed
-- against a real Postgres instance before shipping this.
--
-- Safe to run on a table that already has rows — it only fails if you
-- already have genuine duplicate global overrides sitting in the table
-- (unlikely, since stage 2 hasn't been built yet and nothing writes to this
-- table today). If it does fail, the error will name the conflicting rows;
-- delete the duplicates it points to, keeping whichever is more recent, then
-- re-run this file.

ALTER TABLE user_permission_overrides DROP CONSTRAINT IF EXISTS user_permission_overrides_user_id_plot_id_permission_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_permission_overrides_unique
  ON user_permission_overrides (user_id, COALESCE(plot_id, 0), permission);
