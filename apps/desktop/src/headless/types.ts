export interface DiagResult {
  name: string;
  pass: boolean;
  summary: string;
  details: Record<string, unknown>;
  durationMs: number;
}

export interface DiagModule {
  name: string;
  description: string;
  run(args: Record<string, unknown>): Promise<DiagResult>;
}

export interface ActionResult {
  name: string;
  ok: boolean;
  summary: string;
  details: Record<string, unknown>;
  durationMs: number;
}

export interface ActionModule {
  name: string;
  description: string;
  run(args: Record<string, unknown>): Promise<ActionResult>;
}
