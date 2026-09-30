-- Bokk Yoon — schéma D1 (SQLite), version 3 : modèle opérateur, espaces séparés, références, factures, support.
-- Montants en FCFA entiers. Dates en ISO 8601 UTC.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE,                       -- CL-00012 (client), CH-0007 (chauffeur), EQ-01 (équipe)
  phone TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  bio TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  -- Un compte = un seul espace. Un client ne peut pas être chauffeur avec le même numéro, et inversement.
  role TEXT NOT NULL CHECK (role IN ('client','driver','admin','superadmin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','blocked')),
  suspended_until TEXT,
  status_reason TEXT,
  warnings INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE INDEX IF NOT EXISTS users_role ON users(role, status);

CREATE TABLE IF NOT EXISTS driver_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  id_doc_type TEXT NOT NULL,
  id_doc_last4 TEXT NOT NULL,
  license_last4 TEXT NOT NULL,
  license_since INTEGER,
  insurance_until TEXT,
  payout_provider TEXT NOT NULL DEFAULT 'WAVE' CHECK (payout_provider IN ('WAVE','ORANGE_MONEY','FREE_MONEY')),
  payout_phone TEXT NOT NULL,
  home_city TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL,
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT
);

CREATE TABLE IF NOT EXISTS otps (
  phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL, sent_count INTEGER NOT NULL DEFAULT 1, window_start TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), space TEXT NOT NULL,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL
);
-- Grille tarifaire du propriétaire (prioritaire sur la formule au km). Valable dans les deux sens.
CREATE TABLE IF NOT EXISTS tariffs (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL, dest TEXT NOT NULL,
  client_seat INTEGER NOT NULL CHECK (client_seat >= 0), driver_seat INTEGER NOT NULL CHECK (driver_seat >= 0),
  client_parcel INTEGER NOT NULL CHECK (client_parcel >= 0), driver_parcel INTEGER NOT NULL CHECK (driver_parcel >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT, updated_at TEXT NOT NULL,
  UNIQUE (origin, dest),
  CHECK (driver_seat <= client_seat AND driver_parcel <= client_parcel)
);

CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('citadine','berline','7places','minibus','pickup')),
  seats INTEGER NOT NULL CHECK (seats BETWEEN 1 AND 8),
  cargo_kg INTEGER NOT NULL CHECK (cargo_kg BETWEEN 0 AND 200),
  plate TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS vehicles_owner ON vehicles(owner_id);

CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE,                       -- TR-26-00012
  driver_id TEXT NOT NULL REFERENCES users(id),
  vehicle_id TEXT NOT NULL REFERENCES vehicles(id),
  origin TEXT NOT NULL, origin_lat REAL NOT NULL, origin_lng REAL NOT NULL,
  dest TEXT NOT NULL, dest_lat REAL NOT NULL, dest_lng REAL NOT NULL,
  meeting_point TEXT NOT NULL DEFAULT '',
  departure_at TEXT NOT NULL,
  distance_km REAL NOT NULL, duration_min INTEGER NOT NULL,
  seats_total INTEGER NOT NULL, seats_left INTEGER NOT NULL CHECK (seats_left >= 0),
  parcel_kg_total REAL NOT NULL, parcel_kg_left REAL NOT NULL CHECK (parcel_kg_left >= 0),
  max_detour_km INTEGER NOT NULL DEFAULT 5,
  accepts_categories TEXT NOT NULL DEFAULT 'documents,vetements,alimentaire_sec,cosmetiques,pieces,autre',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('PUBLISHED','FULL','IN_PROGRESS','COMPLETED','CANCELLED','SUSPENDED')),
  started_at TEXT, completed_at TEXT,
  last_lat REAL, last_lng REAL, last_accuracy REAL, last_pos_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trips_open ON trips(status, departure_at);
CREATE INDEX IF NOT EXISTS trips_driver ON trips(driver_id);

CREATE TABLE IF NOT EXISTS trip_positions (
  id TEXT PRIMARY KEY, trip_id TEXT NOT NULL REFERENCES trips(id),
  lat REAL NOT NULL, lng REAL NOT NULL, accuracy REAL, speed REAL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS trip_positions_trip ON trip_positions(trip_id, created_at);

CREATE TABLE IF NOT EXISTS packages (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE,                       -- COL-26-00042
  type_code TEXT NOT NULL DEFAULT 'COLIS',
  sender_id TEXT NOT NULL REFERENCES users(id),
  origin TEXT NOT NULL, origin_lat REAL NOT NULL, origin_lng REAL NOT NULL,
  dest TEXT NOT NULL, dest_lat REAL NOT NULL, dest_lng REAL NOT NULL,
  date_from TEXT NOT NULL, date_to TEXT NOT NULL,
  weight_kg REAL NOT NULL CHECK (weight_kg > 0),
  length_cm INTEGER NOT NULL, width_cm INTEGER NOT NULL, height_cm INTEGER NOT NULL,
  category TEXT NOT NULL, declared_value INTEGER NOT NULL DEFAULT 0,
  fragile INTEGER NOT NULL DEFAULT 0, urgent INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL, recipient_phone TEXT NOT NULL,
  partner_id TEXT, external_ref TEXT,
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','BOOKED','PAID','PICKED_UP','DELIVERED','CANCELLED','DISPUTED')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS packages_sender ON packages(sender_id);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  ref TEXT UNIQUE,                       -- RES-26-00087
  kind TEXT NOT NULL CHECK (kind IN ('SEAT','PARCEL')),
  trip_id TEXT NOT NULL REFERENCES trips(id),
  customer_id TEXT NOT NULL REFERENCES users(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  package_id TEXT REFERENCES packages(id),
  seats INTEGER,
  from_city TEXT NOT NULL, to_city TEXT NOT NULL,
  match_score REAL,
  list_price INTEGER,                                 -- prix avant code promo
  discount INTEGER NOT NULL DEFAULT 0,
  promo_code TEXT,
  price INTEGER NOT NULL CHECK (price >= 0),          -- payé par le client à Bokk Yoon
  driver_pay INTEGER NOT NULL CHECK (driver_pay >= 0), -- reversé par Bokk Yoon au chauffeur
  status TEXT NOT NULL DEFAULT 'PENDING_PAYMENT' CHECK (status IN ('PENDING_PAYMENT','PAID','IN_PROGRESS','COMPLETED','CANCELLED','EXPIRED','DISPUTED','REFUNDED')),
  expires_at TEXT,
  pickup_code TEXT, delivery_code TEXT, track_token TEXT,
  pickup_at TEXT, delivered_at TEXT,
  payout_status TEXT NOT NULL DEFAULT 'NONE' CHECK (payout_status IN ('NONE','DUE','PAID','HELD','CANCELLED')),
  payout_due_at TEXT, payout_id TEXT,
  refund_amount INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((kind = 'SEAT' AND seats IS NOT NULL) OR (kind = 'PARCEL' AND package_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS bookings_customer ON bookings(customer_id);
CREATE INDEX IF NOT EXISTS bookings_driver ON bookings(driver_id, payout_status);
CREATE INDEX IF NOT EXISTS bookings_trip ON bookings(trip_id);
CREATE INDEX IF NOT EXISTS bookings_status ON bookings(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS bookings_track ON bookings(track_token);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id),
  provider TEXT NOT NULL CHECK (provider IN ('WAVE','ORANGE_MONEY','FREE_MONEY','CARD','PARTNER')),
  provider_ref TEXT NOT NULL, amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('CAPTURED','REFUNDED','PARTIALLY_REFUNDED')),
  idempotency_key TEXT UNIQUE, created_at TEXT NOT NULL,
  UNIQUE (provider, provider_ref)
);

-- Reversements du propriétaire aux chauffeurs
CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY, ref TEXT UNIQUE, driver_id TEXT NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0), bookings_count INTEGER NOT NULL,
  provider TEXT NOT NULL, reference TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  paid_by TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id),
  author_id TEXT NOT NULL REFERENCES users(id), target_id TEXT NOT NULL REFERENCES users(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5), comment TEXT NOT NULL DEFAULT '',
  hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE (booking_id, author_id), CHECK (author_id <> target_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id),
  sender_id TEXT NOT NULL REFERENCES users(id), body TEXT NOT NULL,
  masked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_booking ON messages(booking_id, created_at);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY, ref TEXT UNIQUE, booking_id TEXT NOT NULL REFERENCES bookings(id),
  opened_by TEXT NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL CHECK (reason IN ('LOST','DAMAGED','NOT_DELIVERED','NO_SHOW','PAYMENT','OTHER')),
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  decision TEXT, refund_amount INTEGER, handled_by TEXT, created_at TEXT NOT NULL, closed_at TEXT
);

-- Signalements de comportement (client ↔ chauffeur)
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, ref TEXT UNIQUE, reporter_id TEXT NOT NULL REFERENCES users(id), target_id TEXT NOT NULL REFERENCES users(id),
  booking_id TEXT REFERENCES bookings(id),
  category TEXT NOT NULL CHECK (category IN ('COMPORTEMENT','RETARD','CONDUITE','PAIEMENT_HORS_APP','FRAUDE','ANNULATION','AUTRE')),
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  action_taken TEXT, handled_by TEXT, created_at TEXT NOT NULL, closed_at TEXT
);
CREATE INDEX IF NOT EXISTS incidents_target ON incidents(target_id);

-- Historique des sanctions décidées par l'équipe
CREATE TABLE IF NOT EXISTS sanctions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('WARNING','SUSPENSION','BLOCK','REACTIVATION')),
  reason TEXT NOT NULL, until TEXT, by_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sanctions_user ON sanctions(user_id, created_at);

CREATE TABLE IF NOT EXISTS admin_notes (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', link TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'info', read_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at);

CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('ANNONCE','SECURITE','CONSEIL','ROUTE','PROMO')),
  audience TEXT NOT NULL DEFAULT 'ALL' CHECK (audience IN ('ALL','CLIENTS','DRIVERS')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED')),
  published_at TEXT, author_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS news_pub ON news(status, published_at);

-- Alertes route (travaux, affluence, météo) par ville ou région
CREATE TABLE IF NOT EXISTS route_alerts (
  id TEXT PRIMARY KEY, area TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('INFO','ATTENTION','DANGER')),
  message TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
  author_id TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS waitlist (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('conducteur','expediteur','passager','partenaire')),
  city TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE, api_key_prefix TEXT NOT NULL,
  webhook_url TEXT NOT NULL DEFAULT '', webhook_secret TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS partner_events (
  id TEXT PRIMARY KEY, partner_id TEXT NOT NULL REFERENCES partners(id), event TEXT NOT NULL,
  payload TEXT NOT NULL, delivery_status TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, actor_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_time ON audit_logs(created_at);

-- Compteurs des références lisibles (COL-26-00042, FAC-2026-00001…)
CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, value INTEGER NOT NULL);

-- Types d'envoi définis par le propriétaire (colis au poids, passeport au forfait…)
CREATE TABLE IF NOT EXISTS parcel_types (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, label TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL CHECK (mode IN ('WEIGHT','FLAT')),
  client_base INTEGER NOT NULL DEFAULT 0, driver_base INTEGER NOT NULL DEFAULT 0,
  client_per_km REAL NOT NULL DEFAULT 0, driver_per_km REAL NOT NULL DEFAULT 0,
  nominal_kg REAL NOT NULL DEFAULT 0.2, id_check INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 10, updated_at TEXT NOT NULL
);

-- Factures et avoirs (numérotation continue par année)
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('INVOICE','CREDIT_NOTE','MANUAL')),
  booking_id TEXT REFERENCES bookings(id), customer_id TEXT REFERENCES users(id),
  customer TEXT NOT NULL,       -- JSON : nom, téléphone, e-mail, adresse, NINEA
  lines TEXT NOT NULL,          -- JSON : [{label, qty, unit, total}]
  total INTEGER NOT NULL, vat_rate REAL NOT NULL DEFAULT 0, vat_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID','DUE','CANCELLED')),
  notes TEXT NOT NULL DEFAULT '', issued_at TEXT NOT NULL, created_by TEXT
);
CREATE INDEX IF NOT EXISTS invoices_customer ON invoices(customer_id, issued_at);
CREATE INDEX IF NOT EXISTS invoices_booking ON invoices(booking_id);

-- Messages au propriétaire (formulaires de contact, questions, retours)
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, ref TEXT UNIQUE, user_id TEXT REFERENCES users(id),
  name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('QUESTION','RECLAMATION','SUGGESTION','PARTENARIAT','CHAUFFEUR','AUTRE')),
  subject TEXT NOT NULL, booking_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ANSWERED','CLOSED')),
  source TEXT NOT NULL DEFAULT 'app', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tickets_status ON tickets(status, updated_at);
CREATE TABLE IF NOT EXISTS ticket_messages (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES tickets(id), author_id TEXT,
  from_team INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ticket_messages_t ON ticket_messages(ticket_id, created_at);

-- Formulaires de retour après trajet (note de recommandation 0 à 10)
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY, booking_id TEXT NOT NULL REFERENCES bookings(id), user_id TEXT NOT NULL REFERENCES users(id),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 10), liked TEXT NOT NULL DEFAULT '', improve TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, UNIQUE (booking_id, user_id)
);

-- Codes promo (la remise est prise sur la marge Bokk Yoon, pas sur la part chauffeur)
CREATE TABLE IF NOT EXISTS promo_codes (
  id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, label TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('PERCENT','FIXED')), value INTEGER NOT NULL CHECK (value > 0),
  applies TEXT NOT NULL DEFAULT 'ALL' CHECK (applies IN ('ALL','SEAT','PARCEL')),
  max_uses INTEGER, used INTEGER NOT NULL DEFAULT 0, expires_at TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);

-- Paiements déclarés par le client (QR code Wave / Orange Money du propriétaire), vérifiés par l'équipe
CREATE TABLE IF NOT EXISTS payment_claims (
  id TEXT PRIMARY KEY, ref TEXT UNIQUE, booking_id TEXT NOT NULL REFERENCES bookings(id), customer_id TEXT NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL, transaction_ref TEXT NOT NULL, payer_phone TEXT NOT NULL DEFAULT '', payer_name TEXT NOT NULL DEFAULT '',
  amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING', reason TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT REFERENCES users(id), reviewed_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS payment_claims_status ON payment_claims(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS payment_claims_txn ON payment_claims(provider, transaction_ref);
