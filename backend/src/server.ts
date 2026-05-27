import mongoose from "mongoose";
import { app } from "./app.js";
import { env } from "./config/env.js";

async function startServer() {
  await mongoose.connect(env.mongoUri);

  app.listen(env.port, () => {
    console.log(`API listening on http://localhost:${env.port}`);
  });
}

startServer().catch((error) => {
  console.error("Could not start backend.", error);
  process.exit(1);
});
