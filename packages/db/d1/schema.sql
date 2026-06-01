CREATE TABLE IF NOT EXISTS dao_cache (
  dao_id TEXT PRIMARY KEY,
  contract_address TEXT NOT NULL UNIQUE,
  factory_address TEXT NOT NULL,
  name TEXT NOT NULL,
  status INTEGER NOT NULL,
  member_count INTEGER NOT NULL,
  approval_rule INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  terminated_at TEXT,
  synced_block INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dao_members_cache (
  id TEXT PRIMARY KEY,
  dao_id TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (dao_id) REFERENCES dao_cache (dao_id) ON DELETE CASCADE,
  UNIQUE (dao_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_dao_members_cache_wallet_address
  ON dao_members_cache (wallet_address);

CREATE TABLE IF NOT EXISTS proposal_details (
  id TEXT PRIMARY KEY,
  proposal_id INTEGER NOT NULL,
  dao_id TEXT NOT NULL,
  proposal_type INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_wei TEXT,
  recipient TEXT,
  deadline INTEGER NOT NULL,
  approval_type INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (dao_id) REFERENCES dao_cache (dao_id) ON DELETE CASCADE,
  UNIQUE (dao_id, proposal_id)
);

CREATE INDEX IF NOT EXISTS idx_proposal_details_content_hash
  ON proposal_details (content_hash);

CREATE TABLE IF NOT EXISTS proposal_cancel_details (
  id TEXT PRIMARY KEY,
  proposal_detail_id TEXT NOT NULL UNIQUE,
  proposal_id INTEGER NOT NULL,
  dao_id TEXT NOT NULL,
  cancel_reason TEXT NOT NULL,
  cancel_reason_hash TEXT NOT NULL,
  canceled_by TEXT NOT NULL,
  canceled_at TEXT NOT NULL,
  FOREIGN KEY (dao_id) REFERENCES dao_cache (dao_id) ON DELETE CASCADE,
  FOREIGN KEY (proposal_detail_id) REFERENCES proposal_details (id) ON DELETE CASCADE,
  UNIQUE (dao_id, proposal_id)
);

CREATE INDEX IF NOT EXISTS idx_proposal_cancel_details_cancel_reason_hash
  ON proposal_cancel_details (cancel_reason_hash);

CREATE TABLE IF NOT EXISTS evidence_files (
  evidence_id TEXT PRIMARY KEY,
  dao_id TEXT NOT NULL,
  proposal_id INTEGER NOT NULL,
  proposal_key TEXT,
  uploader TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  r2_object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  description TEXT,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (dao_id) REFERENCES dao_cache (dao_id) ON DELETE CASCADE,
  FOREIGN KEY (proposal_key) REFERENCES proposal_details (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_evidence_files_dao_proposal
  ON evidence_files (dao_id, proposal_id);

CREATE INDEX IF NOT EXISTS idx_evidence_files_content_hash
  ON evidence_files (content_hash);

CREATE TABLE IF NOT EXISTS transaction_logs (
  id TEXT PRIMARY KEY,
  tx_hash TEXT NOT NULL,
  log_index INTEGER NOT NULL,
  dao_id TEXT NOT NULL,
  proposal_key TEXT,
  proposal_id INTEGER,
  event_type TEXT NOT NULL,
  actor TEXT,
  amount_wei TEXT,
  status TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (dao_id) REFERENCES dao_cache (dao_id) ON DELETE CASCADE,
  FOREIGN KEY (proposal_key) REFERENCES proposal_details (id) ON DELETE SET NULL,
  UNIQUE (tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_transaction_logs_dao_proposal
  ON transaction_logs (dao_id, proposal_id);

CREATE INDEX IF NOT EXISTS idx_transaction_logs_event_type
  ON transaction_logs (event_type);

CREATE TABLE IF NOT EXISTS sync_state (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  contract_address TEXT NOT NULL,
  last_synced_block INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (source, contract_address)
);
