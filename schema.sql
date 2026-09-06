CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  monthly_credit_target NUMERIC(14,2) NOT NULL DEFAULT 0,
  monthly_expense_limit NUMERIC(14,2) NOT NULL DEFAULT 0,
  savings_target NUMERIC(14,2) NOT NULL DEFAULT 0,
  reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reminder_time TEXT NOT NULL DEFAULT '20:00',
  sound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  browser_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  theme TEXT NOT NULL DEFAULT 'dark',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expense_date DATE NOT NULL,
  expense_time TIME NOT NULL DEFAULT CURRENT_TIME,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  payment_method TEXT DEFAULT 'UPI',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_user_category ON expenses(user_id, category);

CREATE TABLE IF NOT EXISTS credits (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credit_date DATE NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  source TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credits_user_date ON credits(user_id, credit_date);

CREATE TABLE IF NOT EXISTS balance_adjustments (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_balance NUMERIC(14,2) NOT NULL,
  new_balance NUMERIC(14,2) NOT NULL,
  reason TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_presence (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
