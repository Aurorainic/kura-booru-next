import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../schema'

// postgres-js driver uses postgres:// connection string
const connectionString = process.env.DATABASE_URL!
const client = postgres(connectionString, {
  max: 8,
  idle_timeout: 30,
  connect_timeout: 5,
  max_lifetime: 60 * 60,
})
export const db = drizzle(client, { schema })
