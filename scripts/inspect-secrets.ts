import { getDbExec, closeDbExec } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";

loadEnv();

async function main() {
  const db = getDbExec();
  const res = await db.execute("SELECT id, scope, scope_id, key, created_at, updated_at FROM app_secrets");
  console.log("Existing secrets rows count:", res.rows?.length);
  for (const row of res.rows || []) {
    console.log(`row: scope=${row.scope}, scope_id=${row.scope_id}, key=${row.key}`);
  }
}

try {
  await main();
} finally {
  await closeDbExec();
}
