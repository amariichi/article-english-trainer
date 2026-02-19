export type LlmProvider = "nemotron" | "gemini";

export interface GenerateTextInput {
  prompt: string;
  systemPrompt?: string;
  temperature?: number;
  context?: string;
}

export interface GenerateTextResult {
  provider: LlmProvider;
  model: string;
  text: string;
}

export interface LlmClient {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
}
