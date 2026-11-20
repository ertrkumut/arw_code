/**
 * Stand-in for `sharp` in the voice process bundle. transformers.js imports it for image
 * models; voice mode only runs audio models, so the 20 MB native library isn't shipped.
 */
export default function sharp(): never {
  throw new Error('Image processing is not available in ARWCode')
}
