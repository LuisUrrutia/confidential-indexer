create table if not exists event_checkpoints (
  source_name text primary key,
  block_number numeric,
  log_index integer,
  updated_at timestamptz not null default now()
);

create table if not exists transfers (
  chain_id integer not null,
  token_address text not null,
  tx_hash text not null,
  log_index integer not null,
  block_number numeric not null,
  block_timestamp timestamptz not null,
  from_address text not null,
  to_address text not null,
  encrypted_amount text not null,
  amount numeric,
  decryption_status text not null default 'pending',
  decryption_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (chain_id, tx_hash, log_index)
);

create index if not exists transfers_holder_idx on transfers (chain_id, token_address, from_address, to_address, block_number desc, log_index desc);
create index if not exists transfers_status_idx on transfers (decryption_status, block_number asc, log_index asc);

create table if not exists balances (
  chain_id integer not null,
  token_address text not null,
  holder text not null,
  balance numeric,
  balance_status text not null,
  balance_source text not null,
  history_completeness text not null,
  updated_at timestamptz not null default now(),
  primary key (chain_id, token_address, holder)
);

create table if not exists delegations (
  chain_id integer not null,
  token_address text not null,
  delegator text not null,
  delegate text not null,
  active boolean not null,
  expires_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (chain_id, token_address, delegator, delegate)
);

create table if not exists decryption_attempts (
  id bigserial primary key,
  chain_id integer not null,
  token_address text not null,
  tx_hash text not null,
  log_index integer not null,
  status text not null,
  reason text,
  message text,
  created_at timestamptz not null default now()
);
