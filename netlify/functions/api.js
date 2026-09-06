const serverless = require("serverless-http");
const { app, initDb } = require("../../server");

let initialized;
const ensureDb = async () => {
  if (!initialized) initialized = initDb();
  await initialized;
};

const handler = async (event, context) => {
  await ensureDb();
  return serverless(app)(event, context);
};

exports.handler = handler;
