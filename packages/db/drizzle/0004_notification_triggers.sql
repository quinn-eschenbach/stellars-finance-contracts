-- LISTEN/NOTIFY triggers for SSE streaming. Channel names + payload shapes
-- mirror packages/db/src/notifications.ts (CHANNELS + ChannelPayloads).
-- Idempotent: re-running drops and recreates triggers, so a future migration
-- can evolve a payload by reissuing the DDL.

-- oracle_prices: only INSERTs
CREATE OR REPLACE FUNCTION notify_oracle_prices() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('oracle_prices_changed',
    json_build_object('id', NEW.id, 'symbol', NEW.symbol)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS api_oracle_prices_notify ON oracle_prices;
CREATE TRIGGER api_oracle_prices_notify
AFTER INSERT ON oracle_prices
FOR EACH ROW EXECUTE FUNCTION notify_oracle_prices();

-- markets: INSERT or UPDATE
CREATE OR REPLACE FUNCTION notify_markets() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('markets_changed',
    json_build_object('symbol', NEW.symbol)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS api_markets_notify ON markets;
CREATE TRIGGER api_markets_notify
AFTER INSERT OR UPDATE ON markets
FOR EACH ROW EXECUTE FUNCTION notify_markets();

-- vault_state: INSERT or UPDATE
CREATE OR REPLACE FUNCTION notify_vault_state() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('vault_state_changed',
    json_build_object('id', NEW.id)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS api_vault_state_notify ON vault_state;
CREATE TRIGGER api_vault_state_notify
AFTER INSERT OR UPDATE ON vault_state
FOR EACH ROW EXECUTE FUNCTION notify_vault_state();

-- positions: INSERT, UPDATE, DELETE — all matter for the frontend
CREATE OR REPLACE FUNCTION notify_positions() RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    PERFORM pg_notify('positions_changed',
      json_build_object('id', OLD.id, 'trader', OLD.trader, 'symbol', OLD.symbol, 'op', 'DELETE')::text);
    RETURN OLD;
  ELSE
    PERFORM pg_notify('positions_changed',
      json_build_object('id', NEW.id, 'trader', NEW.trader, 'symbol', NEW.symbol, 'op', TG_OP)::text);
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS api_positions_notify ON positions;
CREATE TRIGGER api_positions_notify
AFTER INSERT OR UPDATE OR DELETE ON positions
FOR EACH ROW EXECUTE FUNCTION notify_positions();

-- trades: only INSERTs
CREATE OR REPLACE FUNCTION notify_trades() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('trades_changed',
    json_build_object('id', NEW.id, 'trader', NEW.trader, 'symbol', NEW.symbol, 'event_type', NEW.event_type)::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS api_trades_notify ON trades;
CREATE TRIGGER api_trades_notify
AFTER INSERT ON trades
FOR EACH ROW EXECUTE FUNCTION notify_trades();
