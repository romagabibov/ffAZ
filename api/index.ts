import type { Request, Response } from "express";
import { runtimeApp } from "../src/server/runtime.js";
export default function handler(req: Request, res: Response) {
  try {
    return runtimeApp()(req, res);
  } catch {
    console.error(
      "[startup] Required server configuration is missing or invalid",
    );
    return res
      .status(503)
      .json({
        error: "Сервис не настроен. Проверь серверные переменные окружения.",
        code: "server_configuration_required",
      });
  }
}
