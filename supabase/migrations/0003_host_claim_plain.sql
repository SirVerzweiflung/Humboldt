-- Migration 0003: "plain" host takeover (trusted-players model).
-- Any device that knows the room code may become the host by writing its own uid
-- into rooms.host_id. Replaces the owner-only update policy from 0002.
-- WITH CHECK (host_id = auth.uid()) still forces the claimer to set THEMSELVES as
-- host — you can't hand the room to someone else or blank it out.

drop policy if exists rooms_update_own on public.rooms;

create policy rooms_update_claim
  on public.rooms for update
  using (true)
  with check (host_id = auth.uid());
