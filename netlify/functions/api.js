const serverless = require("serverless-http");
const { app, initDb } = require("../../server");

let initialized;
const ensureDb = async () => {
  if (!initialized) {
    initialized = initDb().catch((err) => {
      initialized = undefined;
      console.error("Database initialization failed:", err.message);
      throw err;
    });
  }
  await initialized;
};

const handler = async (event, context) => {
  await ensureDb();
  return serverless(app)(event, context);
};

exports.handler = handler;
