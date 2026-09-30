declare module 'imagetracerjs' {
  const ImageTracer: {
    imagedataToSVG(imgd: ImageData, options?: Record<string, unknown>): string
  }
  export default ImageTracer
}
