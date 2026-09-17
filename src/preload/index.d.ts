import type { SpinityApi } from './index'

declare global {
  interface Window {
    spinity: SpinityApi
  }
}

export {}
