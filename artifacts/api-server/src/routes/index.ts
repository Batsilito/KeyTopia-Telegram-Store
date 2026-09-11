import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storeRouter from "./store";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storeRouter);

export default router;
