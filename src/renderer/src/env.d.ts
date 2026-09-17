/**
 * Ambient declarations for the non-code imports Vite handles.
 *
 * TypeScript 7 reports TS2882 for a side-effect import of a module it has no
 * declaration for, so the `import './styles.css'` in main.tsx needs this.
 */
declare module '*.css' {
  const content: string
  export default content
}
