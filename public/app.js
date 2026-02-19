const state = {
  sessionId: null,
  currentProvider: "nemotron",
  allowProviderOverride: false,
  audioTurnEnabled: false,
  ttsEnabled: false,
  micStream: null,
  mediaRecorder: null,
  recordedChunks: [],
  recordingMaxTimer: null,
  isRecording: false,
  pttPointerArmed: false,
  keyboardPttKey: null,
  activeRecordingHint: null,
  lastPlaybackAudio: null,
  micMaxRecordingMs: 20000
};

const elements = {
  providerSelect: document.getElementById("provider-select"),
  articleForm: document.getElementById("article-form"),
  articleUrl: document.getElementById("article-url"),
  fetchButton: document.getElementById("fetch-button"),
  articleError: document.getElementById("article-error"),
  manualFallback: document.getElementById("manual-fallback"),
  manualTitle: document.getElementById("manual-title"),
  manualText: document.getElementById("manual-text"),
  manualSubmit: document.getElementById("manual-submit"),
  summaryPanel: document.getElementById("summary-panel"),
  summaryTitle: document.getElementById("summary-title"),
  summaryShort: document.getElementById("summary-short"),
  summaryBullets: document.getElementById("summary-bullets"),
  summaryStarter: document.getElementById("summary-starter"),
  chatForm: document.getElementById("chat-form"),
  chatMessage: document.getElementById("chat-message"),
  chatError: document.getElementById("chat-error"),
  chatLog: document.getElementById("chat-log"),
  sendButton: document.getElementById("send-button"),
  audioTurnPanel: document.getElementById("audio-turn-panel"),
  audioError: document.getElementById("audio-error"),
  pttButtonEn: document.getElementById("ptt-button-en"),
  pttButtonJa: document.getElementById("ptt-button-ja"),
  micStatus: document.getElementById("mic-status"),
  shadowingDifficulty: document.getElementById("shadowing-difficulty"),
  shadowingButton: document.getElementById("shadowing-button"),
  shadowingError: document.getElementById("shadowing-error"),
  shadowingLines: document.getElementById("shadowing-lines"),
  shadowingFocus: document.getElementById("shadowing-focus"),
  statusText: document.getElementById("status-text")
};

bootstrap().catch((error) => {
  setStatus(`Initialization failed: ${error.message}`);
});

async function bootstrap() {
  const config = await fetchJson("/api/config");
  state.currentProvider = config.defaultProvider;
  state.allowProviderOverride = config.allowProviderOverride;
  state.audioTurnEnabled = Boolean(config.audioTurnEnabled);
  state.ttsEnabled = Boolean(config.ttsEnabled);
  state.micMaxRecordingMs =
    typeof config.micMaxRecordingMs === "number" && Number.isFinite(config.micMaxRecordingMs)
      ? Math.max(1, Math.trunc(config.micMaxRecordingMs))
      : 20000;

  elements.providerSelect.value = config.defaultProvider;
  if (!config.allowProviderOverride) {
    elements.providerSelect.disabled = true;
  }

  if (!state.audioTurnEnabled) {
    elements.audioTurnPanel.hidden = true;
  }

  wireEvents();
  setStatus("Ready");
}

function wireEvents() {
  elements.articleForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.articleError.textContent = "";

    const url = elements.articleUrl.value.trim();
    if (!url) {
      elements.articleError.textContent = "記事URLを入力してください。";
      return;
    }

    setBusy(elements.fetchButton, true);
    setStatus("Fetching article and generating summary...");

    try {
      const result = await fetchJson("/api/article/fetch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          provider: elements.providerSelect.value
        })
      });

      await applySession(result);
      elements.manualFallback.hidden = true;
      elements.manualText.value = "";
      setStatus(`Summary ready via ${result.provider} (${result.model})`);
    } catch (error) {
      elements.articleError.textContent = error.message;
      elements.manualFallback.hidden = false;
      setStatus("Article fetch failed. Manual fallback available.");
    } finally {
      setBusy(elements.fetchButton, false);
    }
  });

  elements.manualSubmit.addEventListener("click", async () => {
    elements.articleError.textContent = "";

    const text = elements.manualText.value.trim();
    if (text.length < 300) {
      elements.articleError.textContent = "手動テキストは 300 文字以上入力してください。";
      return;
    }

    setBusy(elements.manualSubmit, true);
    setStatus("Summarizing pasted article text...");

    try {
      const result = await fetchJson("/api/article/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: elements.manualTitle.value.trim() || undefined,
          text,
          sourceUrl: elements.articleUrl.value.trim() || undefined,
          provider: elements.providerSelect.value
        })
      });

      await applySession(result);
      setStatus(`Manual summary ready via ${result.provider} (${result.model})`);
    } catch (error) {
      elements.articleError.textContent = error.message;
      setStatus("Manual fallback failed.");
    } finally {
      setBusy(elements.manualSubmit, false);
    }
  });

  elements.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    elements.chatError.textContent = "";

    if (!state.sessionId) {
      elements.chatError.textContent = "先に記事を取り込んでください。";
      return;
    }

    const message = elements.chatMessage.value.trim();
    if (!message) {
      return;
    }

    const mode = shouldUseJapaneseMode(message) ? "help_ja" : "discussion";

    addChatItem("user", message, mode, null);
    elements.chatMessage.value = "";

    setBusy(elements.sendButton, true);
    setStatus("Generating coach reply...");

    try {
      const result = await fetchJson("/api/session/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: state.sessionId,
          mode,
          message,
          provider: elements.providerSelect.value
        })
      });

      const assistantText = formatAssistantText(result);
      addChatItem("assistant", assistantText, result.mode, `${result.provider} / ${result.model}`);
      await handleSpeechResult(result.speech, result.ttsError, assistantText, "message");
      setStatus(`Reply generated via ${result.provider}`);
    } catch (error) {
      elements.chatError.textContent = error.message;
      setStatus("Message handling failed.");
    } finally {
      setBusy(elements.sendButton, false);
    }
  });

  elements.shadowingButton.addEventListener("click", async () => {
    elements.shadowingError.textContent = "";

    if (!state.sessionId) {
      elements.shadowingError.textContent = "先に記事を取り込んでください。";
      return;
    }

    setBusy(elements.shadowingButton, true);
    setStatus("Generating shadowing lines...");

    try {
      const result = await fetchJson("/api/session/shadowing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: state.sessionId,
          difficulty: elements.shadowingDifficulty.value,
          provider: elements.providerSelect.value
        })
      });

      elements.shadowingLines.innerHTML = "";
      result.script.forEach((line) => {
        const item = document.createElement("li");
        item.textContent = line;
        elements.shadowingLines.appendChild(item);
      });

      elements.shadowingFocus.textContent = `Focus words: ${result.focusWords.join(", ")} (${result.provider} / ${result.model})`;
      addChatItem(
        "assistant",
        `Shadowing script ready.\n${result.script.join("\n")}`,
        "shadowing",
        `${result.provider} / ${result.model}`
      );

      await handleSpeechResult(
        result.speech,
        result.ttsError,
        result.script.join(" "),
        "shadowing"
      );
      setStatus("Shadowing script generated.");
    } catch (error) {
      elements.shadowingError.textContent = error.message;
      setStatus("Shadowing generation failed.");
    } finally {
      setBusy(elements.shadowingButton, false);
    }
  });

  if (state.audioTurnEnabled) {
    setupMicControls();
  }
}

function setupMicControls() {
  registerPttButton(elements.pttButtonEn, "ptt-en", "en");
  registerPttButton(elements.pttButtonJa, "ptt-ja", "ja");

  window.addEventListener("keydown", onGlobalKeyDown);
  window.addEventListener("keyup", onGlobalKeyUp);
  window.addEventListener("beforeunload", releaseMicrophone);

  updateMicUi();
}

function registerPttButton(button, source, languageHint) {
  button.addEventListener("pointerdown", async (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    state.pttPointerArmed = true;
    await startMicRecording(source, languageHint);
  });

  const pointerStop = async () => {
    if (!state.pttPointerArmed) {
      return;
    }
    state.pttPointerArmed = false;
    await stopMicRecordingAndSend();
  };

  button.addEventListener("pointerup", pointerStop);
  button.addEventListener("pointerleave", pointerStop);
  button.addEventListener("pointercancel", pointerStop);
}

async function onGlobalKeyDown(event) {
  if (event.repeat) {
    return;
  }
  if (isTypingTarget(event.target)) {
    return;
  }
  if (event.metaKey || event.shiftKey) {
    return;
  }
  if (state.keyboardPttKey) {
    return;
  }

  if (event.key === "Control" && !event.altKey) {
    event.preventDefault();
    state.keyboardPttKey = "Control";
    await startMicRecording("ctrl", "en");
    return;
  }

  if (event.key === "Alt" && !event.ctrlKey) {
    event.preventDefault();
    state.keyboardPttKey = "Alt";
    await startMicRecording("alt", "ja");
  }
}

async function onGlobalKeyUp(event) {
  if (!state.keyboardPttKey) {
    return;
  }

  if (event.key !== state.keyboardPttKey) {
    return;
  }

  state.keyboardPttKey = null;
  await stopMicRecordingAndSend();
}

async function startMicRecording(source, languageHint) {
  if (!state.audioTurnEnabled) {
    return;
  }
  if (!state.sessionId) {
    elements.audioError.textContent = "先に記事を取り込んでください。";
    return;
  }
  if (state.isRecording) {
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    elements.audioError.textContent = "このブラウザではマイク録音に対応していません。";
    return;
  }

  elements.audioError.textContent = "";
  setStatus("Preparing microphone...");

  try {
    const recorder = await ensureMediaRecorder();
    state.recordedChunks = [];
    state.activeRecordingHint = normalizeLanguageHint(languageHint) ?? "en";
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        state.recordedChunks.push(event.data);
      }
    };
    recorder.start();
    state.isRecording = true;
    if (state.recordingMaxTimer) {
      clearTimeout(state.recordingMaxTimer);
    }
    state.recordingMaxTimer = setTimeout(() => {
      if (!state.isRecording) {
        return;
      }
      stopMicRecordingAndSend().catch(() => {
        // handled in stop flow
      });
    }, state.micMaxRecordingMs);
    updateMicUi(source);
    setStatus("Recording... release to send.");
  } catch (error) {
    elements.audioError.textContent = `マイク初期化に失敗しました: ${error.message}`;
    setStatus("Microphone initialization failed.");
    updateMicUi();
  }
}

async function stopMicRecordingAndSend() {
  if (!state.isRecording) {
    return;
  }
  if (!state.mediaRecorder) {
    state.isRecording = false;
    state.activeRecordingHint = null;
    updateMicUi();
    return;
  }

  const recorder = state.mediaRecorder;
  const recordingHint = state.activeRecordingHint;
  state.isRecording = false;
  state.activeRecordingHint = null;
  if (state.recordingMaxTimer) {
    clearTimeout(state.recordingMaxTimer);
    state.recordingMaxTimer = null;
  }
  updateMicUi();

  setStatus("Processing recorded audio...");
  try {
    const blob = await stopRecorder(recorder, state.recordedChunks);
    state.recordedChunks = [];
    if (!blob || blob.size < 1024) {
      elements.audioError.textContent = "録音が短すぎるため送信しませんでした。";
      setStatus("Recording too short.");
      return;
    }

    await sendAudioBlob(blob, blob.type || recorder.mimeType || "audio/webm", recordingHint);
    setStatus("Audio turn completed.");
  } catch (error) {
    elements.audioError.textContent = `録音処理に失敗しました: ${error.message}`;
    setStatus("Audio recording failed.");
  }
}

async function ensureMediaRecorder() {
  if (state.mediaRecorder && state.micStream && state.micStream.active) {
    return state.mediaRecorder;
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });

  const preferredTypes = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4"
  ];

  const mimeType = preferredTypes.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });

  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  state.micStream = stream;
  state.mediaRecorder = recorder;
  return recorder;
}

function stopRecorder(recorder, chunks) {
  if (recorder.state === "inactive") {
    return Promise.resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
  }

  return new Promise((resolve, reject) => {
    const handleStop = () => {
      cleanup();
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };

    const handleError = () => {
      cleanup();
      reject(new Error("MediaRecorder error"));
    };

    const cleanup = () => {
      recorder.removeEventListener("stop", handleStop);
      recorder.removeEventListener("error", handleError);
    };

    recorder.addEventListener("stop", handleStop, { once: true });
    recorder.addEventListener("error", handleError, { once: true });
    recorder.stop();
  });
}

function releaseMicrophone() {
  if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
    try {
      state.mediaRecorder.stop();
    } catch {
      // Ignore cleanup failures.
    }
  }

  if (state.micStream) {
    state.micStream.getTracks().forEach((track) => track.stop());
  }

  state.mediaRecorder = null;
  state.micStream = null;
  state.recordedChunks = [];
  if (state.recordingMaxTimer) {
    clearTimeout(state.recordingMaxTimer);
    state.recordingMaxTimer = null;
  }
  state.isRecording = false;
  state.keyboardPttKey = null;
  state.activeRecordingHint = null;

  if (state.lastPlaybackAudio) {
    try {
      state.lastPlaybackAudio.pause();
    } catch {
      // Ignore cleanup failures.
    }
    state.lastPlaybackAudio = null;
  }
}

async function sendAudioBlob(blob, mimeType, languageHint) {
  const uploadUrl = buildAudioUploadUrl(mimeType, languageHint);
  const result = await fetchJson(uploadUrl, {
    method: "POST",
    headers: {
      "content-type": mimeType || "application/octet-stream"
    },
    body: blob
  });

  addChatItem(
    "user",
    `[Audio ${result.transcript.language} via ${result.transcript.route}] ${result.transcript.text}`,
    result.assistant.mode,
    null
  );

  const assistantText = formatAssistantText(result.assistant);
  addChatItem(
    "assistant",
    assistantText,
    result.assistant.mode,
    `${result.assistant.provider} / ${result.assistant.model}`
  );

  await handleSpeechResult(result.speech, result.ttsError, assistantText, "audio-turn");
}

function buildAudioUploadUrl(mimeType, languageHint) {
  const params = new URLSearchParams();
  params.set("sessionId", state.sessionId);
  params.set("mimeType", mimeType || "audio/webm");

  const normalizedHint = normalizeLanguageHint(languageHint) ?? inferUiLanguageHint();
  if (normalizedHint) {
    params.set("languageHint", normalizedHint);
  }

  params.set("provider", elements.providerSelect.value);
  return `/api/session/audio-turn-upload?${params.toString()}`;
}

async function handleSpeechResult(speech, ttsError, fallbackText, context) {
  const messages = [];
  if (ttsError) {
    messages.push(`TTS warning: ${ttsError}`);
  }

  if (speech?.audioBase64) {
    if (state.lastPlaybackAudio) {
      try {
        state.lastPlaybackAudio.pause();
      } catch {
        // Ignore stale player cleanup failures.
      }
      state.lastPlaybackAudio = null;
    }
    const src = `data:${speech.mimeType || "audio/wav"};base64,${speech.audioBase64}`;
    const player = new Audio(src);
    player.preload = "auto";
    state.lastPlaybackAudio = player;
    try {
      await player.play();
    } catch {
      messages.push("音声を自動再生できませんでした。");
    }
  } else if (speech?.backend === "minimum_headroom_face_say") {
    const reason = speech.dispatchResult?.reason;
    const spoken = speech.dispatchResult?.spoken;
    const spokenText = spoken === true ? "spoken" : spoken === false ? "rejected" : "unknown";
    messages.push(
      reason && reason !== "timeout-no-say_result"
        ? `face_say dispatch: ${spokenText} (${reason})`
        : `face_say dispatch: ${spokenText}`
    );
  } else if (state.ttsEnabled && context !== "audio-turn") {
    messages.push("TTS backend did not return playable audio.");
  }

  elements.audioError.textContent = messages.join(" / ");

  if (messages.length === 0 && !speech && !ttsError && fallbackText) {
    elements.audioError.textContent = "TTS response is empty.";
  }
}

async function applySession(result) {
  state.sessionId = result.sessionId;
  state.currentProvider = result.provider;

  elements.summaryPanel.hidden = false;
  elements.summaryTitle.textContent = result.article.title;
  elements.summaryShort.textContent = result.summary.short;
  elements.summaryStarter.textContent = `Discussion starter: ${result.summary.discussionStarter}`;
  elements.summaryBullets.innerHTML = "";
  result.summary.bullets.forEach((bullet) => {
    const item = document.createElement("li");
    item.textContent = bullet;
    elements.summaryBullets.appendChild(item);
  });

  elements.chatLog.innerHTML = "";
  addChatItem(
    "assistant",
    `Article summary is ready.\n\n${result.summary.discussionStarter}`,
    "discussion",
    `${result.provider} / ${result.model}`
  );

  await handleSpeechResult(
    result.speech,
    result.ttsError,
    `Article summary is ready. ${result.summary.discussionStarter}`,
    "summary"
  );
}

function formatAssistantText(result) {
  if (result.mode === "help_ja" && result.expressionHint) {
    return `${result.reply}\n\nEN phrase: ${result.expressionHint.en}\nExamples:\n- ${result.expressionHint.examples.join("\n- ")}`;
  }

  return `${result.reply}${result.followUpQuestion ? `\n\nFollow-up: ${result.followUpQuestion}` : ""}`;
}

function addChatItem(role, text, mode, modelLabel) {
  const card = document.createElement("article");
  card.className = `chat-item ${role}`;

  const meta = document.createElement("span");
  meta.className = "chat-meta";
  const segments = [role.toUpperCase(), mode];
  if (modelLabel) {
    segments.push(modelLabel);
  }
  meta.textContent = segments.join(" | ");

  const body = document.createElement("p");
  body.textContent = text;

  card.appendChild(meta);
  card.appendChild(body);
  elements.chatLog.appendChild(card);
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function shouldUseJapaneseMode(message) {
  return looksLikeJapaneseHelpRequest(message);
}

function looksLikeJapaneseHelpRequest(message) {
  if (!message) {
    return false;
  }
  if (/(?:日本語で|日本語\s*を|英語で|訳して|翻訳して|教えて|説明して|言い方|どう言|表現)/.test(message)) {
    return true;
  }
  const normalized = message.toLowerCase();
  if (/(?:\bnihon\s*go\b|\bnippon\s*go\b|\bnihongo\b|\bnihongo\s+de\b)/.test(normalized)) {
    return true;
  }
  if (
    /(?:\bin\s+japanese\b|\bjapanese\s+please\b|\bspeak\s+(?:in\s+)?japanese\b|\banswer\s+in\s+japanese\b|\bexplain\s+in\s+japanese\b)/.test(
      normalized
    )
  ) {
    return true;
  }
  return /\bjapanese\b/.test(normalized) && /\b(speak|answer|explain|teach|translate|use|please)\b/.test(normalized);
}

function inferUiLanguageHint() {
  return "en";
}

function normalizeLanguageHint(value) {
  if (value === "ja" || value === "en" || value === "mixed") {
    return value;
  }
  return null;
}

function isTypingTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function updateMicUi(source = "") {
  if (!state.audioTurnEnabled) {
    return;
  }
  if (state.isRecording) {
    const hint = state.activeRecordingHint || inferUiLanguageHint();
    elements.micStatus.textContent = `録音中 (${source || "mic"}, hint=${hint})... 離す/停止で送信します。`;
    return;
  }
  elements.micStatus.textContent = "PTTボタン（EN/JA）または Ctrl=EN / Alt=JA を長押ししてください。";
}

function setBusy(element, isBusy) {
  element.disabled = isBusy;
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Network error calling ${url}: ${message}`);
  }
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (payload && typeof payload.error === "string") {
      throw new Error(payload.error);
    }
    throw new Error(`Request failed: ${response.status}`);
  }

  return payload;
}
