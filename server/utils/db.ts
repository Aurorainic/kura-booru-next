import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../schema'

// postgres-js driver uses postgres:// connection string
const connectionString = process.env.DATABASE_URL!
// ponytail: 单人用 — 实际并发 4-5 连接（SSR + pipeline + bot + pg-boss），
// max=8 留余量；idle 30s 回收，避免连接常驻吃内存
const client = postgres(connectionString, {
  max: 8,
  idle_timeout: 30,
  connect_timeout: 5,
  max_lifetime: 60 * 60,
})
export const db = drizzle(client, { schema })
