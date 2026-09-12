import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { telegramWebhookHandler } from "./bot";

const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
if (process.env.NODE_ENV === "production" && process.env.TELEGRAM_BOT_TOKEN && !webhookSecret) {
  throw new Error("TELEGRAM_WEBHOOK_SECRET is required when the production Telegram bot is enabled");
}
const allowedOrigins = new Set(
  (process.env.ADMIN_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.disable("x-powered-by");
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin));
  },
}));
app.use(cookieParser());
app.use(express.json({ limit: "256kb" }));

app.use("/api", router);
app.post(["/telegram/webhook", "/api/telegram/webhook"], async (req, res, next) => {
  if (webhookSecret && req.header("x-telegram-bot-api-secret-token") !== webhookSecret) {
    res.status(401).send("Unauthorized");
    return;
  }
  try {
    await telegramWebhookHandler(req, res);
  } catch (error) {
    next(error);
  }
});

export default app;
