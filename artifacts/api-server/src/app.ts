import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { telegramWebhookHandler } from "./bot";

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
app.use(cors());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);
app.post("/telegram/webhook", async (req, res, next) => {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && req.header("x-telegram-bot-api-secret-token") !== expected) {
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
