import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const seedPath = path.resolve(__dirname, "../../db/seed/seed.sql");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required to seed the database.");
  process.exit(1);
}

const sql = fs.readFileSync(seedPath, "utf8");
if (!sql.trim()) {
  console.log("Seed file is empty. Nothing to do.");
  process.exit(0);
}

const client = new Client({ connectionString });

const run = async () => {
  await client.connect();
  try {
    await client.query(sql);
    console.log("Seed completed.");
  } finally {
    await client.end();
  }
};

run().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
