CREATE SCHEMA app;

CREATE TABLE app.users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    score NUMERIC(12, 2),
    ratio DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB,
    avatar BYTEA
);

INSERT INTO app.users (id, email, active, score, ratio, created_at, metadata, avatar)
SELECT value,
       'user-' || value || '@example.test',
       value % 3 <> 0,
       (value % 10000)::numeric / 100,
       value::double precision / 7,
       TIMESTAMPTZ '2024-01-01 00:00:00+00' + value * INTERVAL '1 second',
       jsonb_build_object('id', value, 'fixture', true),
       decode('010203', 'hex')
FROM generate_series(1, 25000) AS value;

SELECT setval(pg_get_serial_sequence('app.users', 'id'), 25000, true);
CREATE VIEW app.active_users AS SELECT * FROM app.users WHERE active;

CREATE TABLE public.notes (id BIGSERIAL PRIMARY KEY, body TEXT NOT NULL);
INSERT INTO public.notes (body) VALUES (repeat('large-cell-', 3000));
