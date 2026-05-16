-- Rename trades.keeper -> trades.executor. The column captures the address
-- that called a permissionless Close path (liquidate_position or
-- execute_order). Now that those entry points dropped the KEEPER role check,
-- the caller is more accurately the "Executor" -- the name aligns with the
-- contract event field rename (Liquidate.keeper -> Liquidate.executor and
-- ExecuteOrder.keeper -> ExecuteOrder.executor).

ALTER TABLE trades RENAME COLUMN keeper TO executor;
