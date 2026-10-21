// Promise.withResolvers for browsers before it shipped (Safari 17.4,
// Chrome 119): the one feature pdf.js's legacy build doesn't fill in
// itself, needed on the page and in its worker. The app is built for
// Safari 16.4 / Chrome 111 (Vite's default), so this closes that gap.

const PromiseWithResolvers = Promise as PromiseConstructor & { withResolvers?: unknown }

if (typeof PromiseWithResolvers.withResolvers !== 'function') {
  PromiseWithResolvers.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
}
