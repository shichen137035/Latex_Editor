interface SourceModel {
  getVersionId(): number;
  getValue(): string;
}

/** Validate a controlled model once per revision, never once per scroll event. */
export class SourceModelContentGuard {
  private model: SourceModel | undefined;
  private version = -1;
  private source: string | undefined;
  private matchesSource = false;

  matches(model: SourceModel, source: string): boolean {
    const version = model.getVersionId();
    if (model !== this.model || version !== this.version || source !== this.source) {
      this.model = model;
      this.version = version;
      this.source = source;
      this.matchesSource = model.getValue().replace(/\r\n?/g, "\n") === source.replace(/\r\n?/g, "\n");
    }
    return this.matchesSource;
  }
}
