declare module '@live-codes/clang-wasm' {
  export interface Compiler {
    run(code: string, input?: string, options?: { compileArgs?: string[] }): Promise<{
      stdout: string; stderr: string; errors: string[]; exitCode: number | null;
    }>;
    dispose(): void;
  }
  export function createCompiler(language: 'cpp', options?: { baseUrl?: URL; std?: string }): Promise<Compiler>;
}
