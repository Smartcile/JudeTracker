declare module "heic-decode" {
  interface DecodedImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }
  export default function decode(options: { buffer: Buffer }): Promise<DecodedImage>;
}
