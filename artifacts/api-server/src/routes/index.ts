import { Router, type IRouter } from "express";
import healthRouter from "./health";
import assistantRouter from "./assistant";
import pushRouter from "./push";

const router: IRouter = Router();

router.use(healthRouter);
router.use(assistantRouter);
router.use(pushRouter);

export default router;
