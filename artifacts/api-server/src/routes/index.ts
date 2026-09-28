import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storeRouter from "./store";
import storageRouter from "./storage";
import venteBotRouter from "./ventebot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(venteBotRouter);
router.use(storeRouter);

export default router;
