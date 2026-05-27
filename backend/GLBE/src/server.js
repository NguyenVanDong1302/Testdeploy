require("dotenv").config();
const http = require("http");
const os = require("os");
const { Server } = require("socket.io");
const { createApp, createCorsOriginMatcher } = require("./app");
const { connectDB } = require("./config/db");
const { initSocket } = require("./realtime/socket");
const { initPostModerationWorker } = require("./services/postModeration.service");

const listEndpoints = require("express-list-endpoints");

function listNetworkUrls(port) {
  const interfaces = os.networkInterfaces();
  const urls = [];

  for (const group of Object.values(interfaces)) {
    for (const item of group || []) {
      if (!item || item.internal || item.family !== "IPv4") continue;
      urls.push(`http://${item.address}:${port}`);
    }
  }

  return Array.from(new Set(urls));
}

async function main() {
  const app = createApp();
  const server = http.createServer(app);
  const corsOrigin = createCorsOriginMatcher();

  const io = new Server(server, {
    cors: {
      origin: corsOrigin,
      credentials: true,
    },
  });
  initSocket(io);

  const port = process.env.PORT || 4000;
  const host = process.env.HOST || "0.0.0.0";

  server.listen(port, host, () => {
    console.log(`Server running at http://localhost:${port}`);
    for (const url of listNetworkUrls(port)) {
      console.log(`LAN access: ${url}`);
    }
    console.log(`Test UI: http://localhost:${port}/`);
  });

  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    console.warn("Missing MONGO_URI in .env (server still running)");
    return;
  }

  try {
    await connectDB(mongoUri);
    initPostModerationWorker();

    console.log("=== API ROUTES ===");
    console.table(listEndpoints(app));
  } catch (err) {
    console.warn(
      "MongoDB connect failed (server still running):",
      err.message,
    );
  }
}

main();
