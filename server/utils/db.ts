import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from '../schema'

// postgres-js driver uses postgres:// connection string
const connectionString = process.env.DATABASE_URL!
// ponytail: max 20 connections — enough for concurrent SSR self-requests
const client = postgres(connectionString, { max: 20 })
export const db = drizzle(client, { schema })
