// pdf.js's worker (it reads the PDF for the preview, pdf-viewer.tsx),
// started from here so the fill-in runs before it: imports run in order.
import '../promise-with-resolvers'
import 'pdfjs-dist/legacy/build/pdf.worker.mjs'
