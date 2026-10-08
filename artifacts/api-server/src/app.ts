import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import reminderWorkerRouter from "./routes/reminder-worker.js";
import {
  ASSISTANT_TRACE_HEADER,
  ASSISTANT_TRACE_VERSION,
  resolveAssistantTraceId,
} from "./lib/assistant-tracing.js";

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

logger.info(
  { assistantTraceVersion: ASSISTANT_TRACE_VERSION },
  "Assistant request tracing enabled",
);

app.use((req, res, next) => {
  const path = req.originalUrl.split("?")[0];
  const isAssistantMessage =
    req.method === "POST" &&
    /^\/api\/assistant\/conversations\/\d+\/messages$/.test(path);
  const isAssistantThreadLoad =
    req.method === "GET" &&
    /^\/api\/assistant\/conversations\/\d+$/.test(path);

  if (!isAssistantMessage && !isAssistantThreadLoad) {
    next();
    return;
  }

  const traceId = resolveAssistantTraceId(req.get(ASSISTANT_TRACE_HEADER));
  req.headers[ASSISTANT_TRACE_HEADER] = traceId;
  res.setHeader(ASSISTANT_TRACE_HEADER, traceId);

  const startedAt = Date.now();
  const traceLog = req.log.child({
    assistantTraceId: traceId,
    assistantTraceVersion: ASSISTANT_TRACE_VERSION,
  });
  traceLog.info(
    { stage: "request_received", method: req.method, path },
    "Assistant trace request received",
  );
  res.on("finish", () => {
    traceLog.info(
      {
        stage: "http_response",
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      },
      "Assistant trace HTTP response finished",
    );
  });

  next();
});

app.use(cors());
// This bodyless endpoint authenticates before JSON/body parsing or worker work.
app.use("/api", reminderWorkerRouter);
// Allow one resized photo only on the message endpoint; all other JSON routes keep the default limit.
const messageJson = express.json({ limit: "4mb" });
app.use((req, res, next) => {
  if (req.method === "POST" && /^\/api\/assistant\/conversations\/\d+\/messages$/.test(req.path)) {
    messageJson(req, res, next);
    return;
  }
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
