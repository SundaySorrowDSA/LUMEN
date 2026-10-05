import { Router, type IRouter } from "express";
import healthRouter from "./health";
import assistantRouter from "./assistant";
import pushRouter from "./push";
import testImageRouter from "./test-image";

const router: IRouter = Router();

router.use(healthRouter);
router.use(assistantRouter);
router.use(pushRouter);
router.use(testImageRouter);

export default router;
