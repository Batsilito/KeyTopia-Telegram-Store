import app from "./app";
import { logger } from "./lib/logger";
import { buildTelegramBot, startStoreNotificationScheduler } from "./bot";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  const bot = buildTelegramBot();
  const developmentPollingEnabled =
    process.env.NODE_ENV !== "production" &&
    process.env.TELEGRAM_DEV_POLLING === "true";
  const backgroundJobsEnabled =
    process.env.NODE_ENV === "production" || developmentPollingEnabled;
  if (backgroundJobsEnabled) {
    startStoreNotificationScheduler();
  }
  if (bot && developmentPollingEnabled) {
    void (async () => {
      try {
        const botInfo = await bot.api.getMe();
        logger.info({ username: botInfo.username }, "Telegram bot identity verified");
        await bot.api.deleteWebhook({ drop_pending_updates: false });
        logger.info("Cleared Telegram webhook before starting development polling");
        logger.info("Starting Telegram long polling");
        await bot.start();
      } catch (error) {
        logger.error({ err: error }, "Telegram polling stopped");
      }
    })();
  }
});
