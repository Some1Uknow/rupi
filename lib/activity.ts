import { getPool } from "./db";

export type ActivityItem = {
  id: string;
  operation_id: string;
  transaction_hash: string;
  kind: string;
  direction: "IN" | "OUT";
  status: string;
  amount: string;
  asset_code: string;
  memo: string | null;
  source_address: string | null;
  destination_address: string | null;
  occurred_at: string;
};

export async function listActivity(userId: string, limit = 50) {
  const result = await getPool().query<ActivityItem>(
    `SELECT id, operation_id, transaction_hash, kind, direction, status, amount::text,
       asset_code, memo, source_address, destination_address, occurred_at
     FROM stellar_operations
     WHERE user_id = $1
     ORDER BY occurred_at DESC
     LIMIT $2`,
    [userId, Math.min(Math.max(limit, 1), 100)],
  );
  return result.rows;
}
