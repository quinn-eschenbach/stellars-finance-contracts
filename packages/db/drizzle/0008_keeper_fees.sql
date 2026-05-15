-- keeper_fees: append-only audit log of every successful keeper submission,
-- one row per tx with the realised on-chain fee. Lets us answer
-- "how much did the keeper spend today" / "which op type is most expensive"
-- without holding state in the keeper process.

CREATE TABLE keeper_fees (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tx_hash text NOT NULL,
  ledger integer NOT NULL,
  "timestamp" numeric NOT NULL,
  op_type text NOT NULL,
  symbol text,
  trader text,
  fee_charged_stroops numeric NOT NULL,
  created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX keeper_fees_op_type_timestamp_idx ON keeper_fees(op_type, "timestamp");
CREATE INDEX keeper_fees_tx_hash_idx ON keeper_fees(tx_hash);
