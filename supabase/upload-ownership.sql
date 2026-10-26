-- Apply before deploying the resume/cancel routes. Legacy rows remain unclaimed;
-- only operator cleanup can discard those unfinished uploads.
alter table public.files add column if not exists user_id uuid references auth.users(id);
create index if not exists files_unfinished_owner_idx
  on public.files (user_id, created_at desc)
  where status in ('UPLOADING', 'FAILED') and deleted_at is null;
