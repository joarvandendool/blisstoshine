import { config } from "dotenv";

config({ path: ".env" });

// Integratietests gebruiken de aparte testdatabase; domeintests raken geen DB.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}
process.env.APP_ENV = "test";
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = "test-secret-met-minimaal-32-tekens-0000";
}
