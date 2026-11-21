import type { CropRect } from "../method.ts";

export class VideoInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoInputError";
  }
}

export interface VideoFrame {
  index: number;
  timestamp: number;
  path: string;
}

export interface FrameSet {
  source: "video" | "folder";
  frames: VideoFrame[];
}

export interface VideoEvent {
  time: number;
  rect?: CropRect;
}
