import type { SlipExtraction } from '../schemas/slip.schema';

export type SlipVisionCandidate = {
  bbox_1000: [number, number, number, number];
  visual_cues: string[];
  data: SlipExtraction;
};

export function adaptSlipVisionResponse(response: unknown): SlipVisionCandidate[];
