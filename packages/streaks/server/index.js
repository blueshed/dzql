import { createServer } from "dzql/server";
import * as customApi from "./api.js";

const server = await createServer({
  port: 3001,
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-in-production",
  customApi
});

console.log(`Streaks server running on http://localhost:3001`);
