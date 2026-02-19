import { access } from "node:fs/promises";

import { Router } from "express";

import type { AppContext } from "../types/appContext.js";

export function createConfigRouter(context: AppContext): Router {
  const router = Router();

  router.get("/api/config", async (_req, res) => {
    let hasSavedAuthState = false;
    try {
      await access(context.env.AGENT_BROWSER_STATE_PATH);
      hasSavedAuthState = true;
    } catch {
      hasSavedAuthState = false;
    }

    res.json({
      defaultProvider: context.env.LLM_PROVIDER,
      availableProviders: ["nemotron", "gemini"],
      allowProviderOverride: context.env.ALLOW_PROVIDER_OVERRIDE,
      hasSavedAuthState,
      audioTurnEnabled: Boolean(
        context.env.ASR_FAST_URL ||
          context.env.ASR_JA_URL ||
          context.env.ASR_EN_URL ||
          context.env.ASR_MIXED_URL
      ),
      micMaxRecordingMs: context.env.MIC_MAX_RECORDING_MS,
      ttsEnabled:
        context.env.TTS_BACKEND !== "disabled" &&
        (context.env.TTS_BACKEND === "minimum_headroom_face_say" || Boolean(context.env.TTS_ENDPOINT_URL)),
      ttsBackend: context.env.TTS_BACKEND,
      defaultVoice: context.env.TTS_DEFAULT_VOICE
    });
  });

  return router;
}
