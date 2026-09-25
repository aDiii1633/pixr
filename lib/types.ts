// Shared server/client contract (ARCHITECTURE §5). Type-only: safe to import from client components.

export type UiState = "IDLE" | "LISTENING" | "THINKING" | "EXECUTING" | "ASKING" | "CONFIRMATION" | "SPEAKING" | "SUCCESS" | "ERROR";
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped" | "needs_input";

export interface Link { label: string; url: string }
export interface PlanStep { id: string; label: string; tool?: string; integration?: string; status: StepStatus; summary?: string; links?: Link[] }
export interface Outcome { label: string; status: "verified" | "unverified" | "failed" | "cancelled"; summary: string; integration?: string; links?: Link[] }
export type Proposal = { id: string; kind: "contact"; name: string; email: string } | { id: string; kind: "fact"; content: string };

export interface AskPayload { kind: "ask"; question: string; field: string; inputHint?: "email" | "text" | "date" | "time" | "choice"; choices?: string[] }
export interface ConfirmPayload { kind: "confirm"; actionId: string; tool: string; integration: string; risk: "low" | "high"; title: string; verb: string; rows: [string, string][]; flags: string[]; editable: { key: string; label: string; value: string; multiline?: boolean }[] }
export type InterruptPayload = AskPayload | ConfirmPayload;

export type AgentEvent =
  | { type: "task"; taskId: string; request: string }
  | { type: "state"; state: UiState; label?: string }
  | { type: "plan"; steps: PlanStep[] }
  | { type: "step"; step: PlanStep }
  | { type: "ask"; payload: AskPayload }
  | { type: "confirm"; payload: ConfirmPayload }
  | { type: "final"; spoken: string; outcomes: Outcome[]; proposals: Proposal[]; status: "completed" | "failed" | "cancelled" }
  | { type: "error"; userMessage: string }
  | { type: "done"; pending: boolean };

export type ResumeValue =
  | { kind: "answer"; value: string }
  | { kind: "confirm"; decision: "approve" | "cancel" | "edit"; edits?: Record<string, string> };

export interface IntegrationStatus {
  id: string; name: string; blurb: string; provider: string;
  status: "connected" | "not_connected" | "error" | "connecting";
  via?: "swytchcode" | "relay";
  account?: string; detail?: string; checkedAt?: string;
}
