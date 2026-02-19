export type SpeechLanguage = "ja" | "en" | "mixed" | "unknown";
export type AsrRoute = "ja" | "en" | "mixed";

export interface LanguageConfidence {
  ja: number;
  en: number;
}

export interface AsrRoutingInput {
  audioBase64: string;
  mimeType: string;
  languageHint?: Exclude<SpeechLanguage, "unknown">;
}

export interface AsrTranscriptionResult {
  text: string;
  language: SpeechLanguage;
  route: AsrRoute;
  languageConfidence: LanguageConfidence;
}

export interface AsrClient {
  transcribeWithRouting(input: AsrRoutingInput): Promise<AsrTranscriptionResult>;
}

export interface TtsSynthesisInput {
  text: string;
  language: "ja" | "en";
  voice?: string;
}

export interface TtsDispatchResult {
  spoken: boolean | null;
  reason: string | null;
  messageId?: string;
}

export interface TtsSynthesisResult {
  backend: "http_audio" | "minimum_headroom_face_say";
  dispatched: boolean;
  audioBase64?: string;
  mimeType?: string;
  voice: string;
  language: "ja" | "en";
  dispatchResult?: TtsDispatchResult;
}

export interface TtsClient {
  synthesize(input: TtsSynthesisInput): Promise<TtsSynthesisResult | null>;
}
