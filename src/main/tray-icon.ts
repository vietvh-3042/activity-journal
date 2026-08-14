import { nativeImage } from 'electron';

export function createTrayIcon() {
  const size = 16;
  const bytes = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * 4;
      const isLine = x === 7 || y === 7;
      bytes[offset] = isLine ? 255 : 20;
      bytes[offset + 1] = isLine ? 255 : 116;
      bytes[offset + 2] = isLine ? 255 : 186;
      bytes[offset + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(bytes, { width: size, height: size, scaleFactor: 1 });
}
