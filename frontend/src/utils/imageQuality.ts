/**
 * Computes sharpness score using Laplacian Variance on an HTMLCanvasElement.
 * Returns a score roughly between 0 and 100+ (higher is sharper).
 * Typically:
 *  - < 25: Very blurry (motion blur / unfocused)
 *  - 25 - 50: Borderline acceptable
 *  - > 50: Sharp and clear
 */
export function calculateSharpnessScore(canvas: HTMLCanvasElement): number {
  try {
    // Create downscaled canvas for fast processing (320px wide)
    const targetWidth = 320;
    const targetHeight = Math.round((canvas.height / canvas.width) * targetWidth);

    const offscreen = document.createElement('canvas');
    offscreen.width = targetWidth;
    offscreen.height = targetHeight;
    const ctx = offscreen.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 100; // Fallback to safe score if context fails

    ctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
    const imgData = ctx.getImageData(0, 0, targetWidth, targetHeight);
    const data = imgData.data;

    // Convert to grayscale matrix
    const gray = new Float32Array(targetWidth * targetHeight);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      // Luminance: 0.299 R + 0.587 G + 0.114 B
      gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }

    // Apply discrete 3x3 Laplacian operator kernel:
    // [  0,  1,  0 ]
    // [  1, -4,  1 ]
    // [  0,  1,  0 ]
    let sum = 0;
    let sumSq = 0;
    let count = 0;

    for (let y = 1; y < targetHeight - 1; y++) {
      const rowOffset = y * targetWidth;
      const prevRow = (y - 1) * targetWidth;
      const nextRow = (y + 1) * targetWidth;

      for (let x = 1; x < targetWidth - 1; x++) {
        const laplacian =
          gray[prevRow + x] +
          gray[nextRow + x] +
          gray[rowOffset + (x - 1)] +
          gray[rowOffset + (x + 1)] -
          4 * gray[rowOffset + x];

        sum += laplacian;
        sumSq += laplacian * laplacian;
        count++;
      }
    }

    if (count === 0) return 100;

    const mean = sum / count;
    const variance = (sumSq / count) - (mean * mean);

    return Math.max(0, Math.round(variance));
  } catch (err) {
    console.warn('Sharpness calculation failed:', err);
    return 100;
  }
}

/**
 * Checks whether an image is considered blurry based on a threshold
 */
export function isImageBlurry(sharpnessScore: number, threshold: number = 28): boolean {
  return sharpnessScore < threshold;
}

