import type { ImageInput } from "./image-io.ts";
import type { TargetModel } from "./estimators.ts";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MethodRequest {
  image: ImageInput;
  previous?: ImageInput;
  model: TargetModel;
  region?: CropRect;
}

export interface MethodResult {
  method: string;
  image?: Uint8Array;
  text?: string;
  width?: number;
  height?: number;
  estimatedTokens: number;
}

export interface ReductionMethod {
  name: string;
  apply(request: MethodRequest): Promise<MethodResult | undefined>;
}
