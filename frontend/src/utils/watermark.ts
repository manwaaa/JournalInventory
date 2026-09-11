/**
 * Draws a clean, subtle semi-transparent audit badge in the bottom corner of an HTML5 canvas.
 */
export interface WatermarkOptions {
  isbn: string;
  stationName?: string;
  shotLabel?: string;
  timestamp?: string;
}

export function drawAuditWatermark(
  canvas: HTMLCanvasElement,
  options: WatermarkOptions
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const {
    isbn,
    stationName = 'Station-01',
    shotLabel = '',
    timestamp = new Date().toLocaleString()
  } = options;

  ctx.save();

  // Determine font size dynamically based on canvas width (e.g. 1920x1080 -> 18-20px)
  const baseFontSize = Math.max(14, Math.round(canvas.width / 110));
  ctx.font = `600 ${baseFontSize}px 'JetBrains Mono', monospace, sans-serif`;

  const text = `PROOFAUDIT │ ${isbn} │ ${shotLabel ? shotLabel + ' │ ' : ''}${timestamp} │ ${stationName}`;
  const textMetrics = ctx.measureText(text);
  const textWidth = textMetrics.width;
  const paddingX = baseFontSize * 0.9;
  const paddingY = baseFontSize * 0.55;

  const boxWidth = textWidth + paddingX * 2;
  const boxHeight = baseFontSize + paddingY * 2;

  // Margin from bottom-left corner
  const margin = Math.round(baseFontSize * 1.2);
  const x = margin;
  const y = canvas.height - boxHeight - margin;
  const radius = 6;

  // Draw semi-transparent dark rounded pill background
  ctx.fillStyle = 'rgba(15, 23, 42, 0.78)'; // Slate 900 with 78% opacity
  ctx.beginPath();
  ctx.roundRect(x, y, boxWidth, boxHeight, radius);
  ctx.fill();

  // Subtle border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Accent dot indicator
  const dotX = x + paddingX * 0.6;
  const dotY = y + boxHeight / 2;
  const dotRadius = Math.max(3, baseFontSize * 0.2);

  ctx.fillStyle = '#10b981'; // Emerald dot
  ctx.beginPath();
  ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
  ctx.fill();

  // Render text
  ctx.fillStyle = '#f8fafc';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + paddingX * 1.2, y + boxHeight / 2);

  ctx.restore();
}

