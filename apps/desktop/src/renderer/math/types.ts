export interface MathContext {
  macros: Record<string, string>;
  operators: Record<string, string>;
  sourceVersion: number;
}

export interface ParsedMacroDefinition {
  name: string;
  replacement: string;
  argumentCount: number;
  sourceFile: string;
  sourceStart: number;
  sourceEnd: number;
  declaration: "newcommand" | "renewcommand" | "providecommand" | "DeclareMathOperator";
}

export type MathNodeKind = "inline-dollar" | "inline-paren" | "display-dollar" | "display-bracket" | "environment";

export interface MathNode {
  id: string;
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  kind: MathNodeKind;
  environmentName?: string;
  displayMode: boolean;
}

export interface MathRenderError {
  message: string;
  position?: number;
  recoverable: boolean;
}

export interface MathRenderOptions {
  displayMode: boolean;
  throwOnError?: boolean;
}

export interface MathRenderResult {
  html?: string;
  error?: MathRenderError;
}

export const EMPTY_MATH_CONTEXT: MathContext = { macros: {}, operators: {}, sourceVersion: 0 };
