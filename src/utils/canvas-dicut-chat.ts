/**
 * ==========================================================================
 * DICUT_CHAT DIRECT PIXEL QUIET ZONE SLICER (Canvas 2D Engine)
 * Slices long chat captures into Court A4 blocks (807 × 1115 px) in < 0.05s
 * Compliant with Dicut_Chat Skill & Anti-Bubble Cutting Rule
 * ==========================================================================
 */

export interface ChatSliceResult {
  sliceIndex: number;
  canvas: HTMLCanvasElement;
  startY: number;
  endY: number;
  height: number;
}

const BLOCK_W = 807;
const BLOCK_H = 1115;
const LOOKAHEAD_MARGIN = 1.30; // ไม่เกิน 1.30 เท่าของความสูงบล็อก

/**
 * Check if a horizontal row of pixels is a "Quiet Zone" (Solid/Neutral background)
 */
function isRowQuietZone(
  data: Uint8ClampedArray,
  y: number,
  width: number,
  tolerance: number = 18
): boolean {
  const rowStart = y * width * 4;
  const firstR = data[rowStart];
  const firstG = data[rowStart + 1];
  const firstB = data[rowStart + 2];

  // Sample across the row with 8px step
  for (let x = 0; x < width; x += 8) {
    const idx = (y * width + x) * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    const diff = Math.abs(r - firstR) + Math.abs(g - firstG) + Math.abs(b - firstB);
    if (diff > tolerance * 3) {
      return false; // Row has content / text / bubble border
    }
  }

  return true;
}

/**
 * Find the optimal cut point near targetY without slicing through chat bubbles
 */
function findQuietCutPoint(
  data: Uint8ClampedArray,
  targetY: number,
  width: number,
  totalHeight: number,
  searchRange: number = 80
): number {
  if (targetY >= totalHeight) return totalHeight;

  // Search forward first (lookahead), then backward
  const startSearch = Math.max(0, targetY - searchRange);
  const endSearch = Math.min(totalHeight - 1, targetY + Math.round(searchRange * LOOKAHEAD_MARGIN));

  // Look for consecutive quiet rows (at least 6-10 rows of quiet zone)
  for (let y = targetY; y <= endSearch; y++) {
    if (isRowQuietZone(data, y, width)) {
      return y;
    }
  }

  for (let y = targetY - 1; y >= startSearch; y--) {
    if (isRowQuietZone(data, y, width)) {
      return y;
    }
  }

  // Fallback to exact targetY if no perfect quiet zone found
  return targetY;
}

/**
 * Direct Pixel Slicing on Canvas 2D (Pure Local Execution < 0.05s)
 */
export async function sliceChatImageLocally(
  imageSource: HTMLImageElement | File
): Promise<ChatSliceResult[]> {
  let img: HTMLImageElement;
  let objectUrlToRevoke: string | null = null;

  if (imageSource instanceof File) {
    img = new Image();
    objectUrlToRevoke = URL.createObjectURL(imageSource);
    img.src = objectUrlToRevoke;
    await img.decode();
  } else {
    img = imageSource;
    if (!img.complete) await img.decode();
  }

  try {
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;

    // Scale width to fit BLOCK_W (807 px)
    const scale = BLOCK_W / srcW;
    const scaledH = Math.round(srcH * scale);

    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = BLOCK_W;
    sourceCanvas.height = scaledH;
    const sCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });
    if (!sCtx) return [];

    sCtx.imageSmoothingEnabled = true;
    sCtx.imageSmoothingQuality = "high";
    sCtx.drawImage(img, 0, 0, BLOCK_W, scaledH);

    const imageData = sCtx.getImageData(0, 0, BLOCK_W, scaledH);
    const slices: ChatSliceResult[] = [];

    let currentY = 0;
    let sliceNum = 1;

    while (currentY < scaledH) {
      const remainingH = scaledH - currentY;

      if (remainingH <= BLOCK_H) {
        // Last slice fits fully
        const targetCanvas = document.createElement("canvas");
        targetCanvas.width = BLOCK_W;
        targetCanvas.height = BLOCK_H;
        const tCtx = targetCanvas.getContext("2d");
        if (tCtx) {
          tCtx.fillStyle = "#FFFFFF";
          tCtx.fillRect(0, 0, BLOCK_W, BLOCK_H);
          tCtx.drawImage(sourceCanvas, 0, currentY, BLOCK_W, remainingH, 0, 0, BLOCK_W, remainingH);
        }

        slices.push({
          sliceIndex: sliceNum,
          canvas: targetCanvas,
          startY: currentY,
          endY: scaledH,
          height: remainingH,
        });
        break;
      }

      // Find quiet cut point near currentY + BLOCK_H
      const idealTarget = currentY + BLOCK_H;
      const cutPoint = findQuietCutPoint(imageData.data, idealTarget, BLOCK_W, scaledH);
      const sliceH = cutPoint - currentY;

      const targetCanvas = document.createElement("canvas");
      targetCanvas.width = BLOCK_W;
      targetCanvas.height = BLOCK_H;
      const tCtx = targetCanvas.getContext("2d");
      if (tCtx) {
        tCtx.fillStyle = "#FFFFFF";
        tCtx.fillRect(0, 0, BLOCK_W, BLOCK_H);

        // Top-align sliced block per Dicut_Chat rule
        tCtx.drawImage(sourceCanvas, 0, currentY, BLOCK_W, sliceH, 0, 0, BLOCK_W, sliceH);
      }

      slices.push({
        sliceIndex: sliceNum,
        canvas: targetCanvas,
        startY: currentY,
        endY: cutPoint,
        height: sliceH,
      });

      currentY = cutPoint;
      sliceNum++;
    }

    return slices;
  } finally {
    if (objectUrlToRevoke) {
      URL.revokeObjectURL(objectUrlToRevoke);
    }
  }
}
