/** Type surface for existing react-dom dependency; no dependency installation. */
declare module "react-dom/client" {
  export function createRoot(container: Element): {
    render(node: import("react").ReactNode): void;
  };
}
