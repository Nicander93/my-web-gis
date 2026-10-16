import type { BillboardStyle } from './index.js'

const pinImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="44" viewBox="0 0 32 44"><path fill="#3b796a" stroke="#fff" stroke-width="2" d="M16 42C13 36 1 25 1 16a15 15 0 0 1 30 0c0 9-12 20-15 26Z"/><circle cx="16" cy="16" r="5" fill="#fff"/></svg>')

/** Copy defaults at creation so editing one graphic never changes the next preset. */
export function createBillboardStyle(): BillboardStyle { return { image: pinImage, width: 32, height: 44 } }
