-- SYNTHETIC WEAKENING - never applied. The MECHANISM itself, put back. Every per-table
-- assertion in the tree stays green -- the three healthy tables keep their exact revokes -- and
-- yet every table created after this statement is born with the full DML surface again. This is
-- what 0028 part (5) shut off, and re-adding it has to be red on its own, not merely as an
-- eventual consequence someone notices two migrations later.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
