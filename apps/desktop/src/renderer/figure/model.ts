export interface SourceRange { start: number; end: number }

export interface GraphicOption {
  key: string;
  value?: string;
  raw: string;
}

export interface ImageObject {
  id: string;
  sourcePath: string;
  options: GraphicOption[];
  sourceRange: SourceRange;
  pathRange: SourceRange;
  optionsRange?: SourceRange;
}

export interface SubfigureObject {
  id: string;
  width?: string;
  caption?: string;
  label?: string;
  sourceRange: SourceRange;
  images: ImageObject[];
}

export interface FigureObject {
  id: string;
  environment: "figure" | "figure*" | "inline";
  placement?: string;
  alignment: "left" | "center" | "right" | "none";
  caption?: string;
  label?: string;
  sourceRange: SourceRange;
  images: ImageObject[];
  subfigures: SubfigureObject[];
  partiallyEditable: boolean;
}

export interface FigurePatch {
  imageIndex?: number;
  sourcePath?: string;
  width?: string;
  height?: string;
  scale?: string;
  angle?: string;
  keepAspectRatio?: boolean;
  caption?: string;
  label?: string;
  placement?: string;
  alignment?: FigureObject["alignment"];
}
