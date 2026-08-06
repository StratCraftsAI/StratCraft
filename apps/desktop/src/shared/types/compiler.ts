export interface CompilerErrorEntry {
  line: number;
  column: number;
  severity: 'error' | 'warning' | 'note';
  message: string;
}

export interface ParsedCompilerError {
  summary: string;
  errors: CompilerErrorEntry[];
  errorCount: number;
  warningCount: number;
  rawOutput: string;
}

export interface CompilationStatusUpdate {
  algorithmId: string;
  status: 'compiling' | 'success' | 'error';
  error?: string;
  parsedErrors?: ParsedCompilerError;
}
