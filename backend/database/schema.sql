-- 1. USERS TABLE (Admins, Managers, Tenants)
CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(100) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,        -- stored hashed, never plain text
  role        VARCHAR(20) DEFAULT 'admin', -- admin | manager | tenant
  phone       VARCHAR(20),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 2. PLOTS TABLE (Properties / Buildings)
CREATE TABLE plots (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER REFERENCES users(id),
  name        VARCHAR(100) NOT NULL,
  location    VARCHAR(200),
  description TEXT,
  gps_lat     DECIMAL(10,8),
  gps_lng     DECIMAL(11,8),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 3. HOUSES TABLE (Individual rental units)
CREATE TABLE houses (
  id          SERIAL PRIMARY KEY,
  plot_id     INTEGER REFERENCES plots(id) ON DELETE CASCADE,
  unit_number VARCHAR(20) NOT NULL,
  house_type  VARCHAR(50),               -- Bedsitter, 1 Bed, 2 Bed, Shop
  rent_amount DECIMAL(10,2) NOT NULL,
  deposit     DECIMAL(10,2),
  status      VARCHAR(20) DEFAULT 'vacant', -- vacant | occupied
  meter_no    VARCHAR(50),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 4. TENANTS TABLE
CREATE TABLE tenants (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER REFERENCES users(id),  -- tenant's login account
  house_id         INTEGER REFERENCES houses(id),
  full_name        VARCHAR(100) NOT NULL,
  national_id      VARCHAR(30),
  phone            VARCHAR(20),
  email            VARCHAR(100),
  emergency_phone  VARCHAR(20),
  move_in_date     DATE,
  rent_due_day     INTEGER DEFAULT 5,
  deposit_paid     DECIMAL(10,2) DEFAULT 0,
  balance          DECIMAL(10,2) DEFAULT 0,       -- outstanding rent
  photo_url        VARCHAR(255),
  lease_url        VARCHAR(255),
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- 5. PAYMENTS TABLE (All M-Pesa transactions)
CREATE TABLE payments (
  id             SERIAL PRIMARY KEY,
  tenant_id      INTEGER REFERENCES tenants(id),
  transaction_id VARCHAR(50) UNIQUE,              -- M-Pesa transaction code
  amount         DECIMAL(10,2) NOT NULL,
  phone          VARCHAR(20),
  payment_date   TIMESTAMP DEFAULT NOW(),
  house_id       INTEGER REFERENCES houses(id),
  method         VARCHAR(30) DEFAULT 'mpesa',
  status         VARCHAR(20) DEFAULT 'unmatched', -- matched | unmatched | review
  match_score    INTEGER DEFAULT 0,               -- 0-100 confidence
  receipt_no     VARCHAR(50),
  notes          TEXT
);

-- 6. EXPENSES TABLE
CREATE TABLE expenses (
  id          SERIAL PRIMARY KEY,
  plot_id     INTEGER REFERENCES plots(id),
  category    VARCHAR(50),    -- Repairs, Electricity, Water, Security etc.
  description TEXT,
  amount      DECIMAL(10,2),
  expense_date DATE,
  receipt_url VARCHAR(255),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 7. MAINTENANCE REQUESTS
CREATE TABLE maintenance_requests (
  id          SERIAL PRIMARY KEY,
  tenant_id   INTEGER REFERENCES tenants(id),
  house_id    INTEGER REFERENCES houses(id),
  issue       TEXT NOT NULL,
  photo_url   VARCHAR(255),
  priority    VARCHAR(20) DEFAULT 'medium',
  status      VARCHAR(20) DEFAULT 'pending', -- pending | in_progress | completed
  reported_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

-- 8. SMS LOGS
CREATE TABLE sms_logs (
  id          SERIAL PRIMARY KEY,
  to_phone    VARCHAR(20),
  message     TEXT,
  status      VARCHAR(20),  -- sent | failed
  sent_at     TIMESTAMP DEFAULT NOW()
);

-- Run this file in psql:
-- \i database/schema.sql