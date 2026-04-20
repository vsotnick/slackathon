/// <reference types="vite/client" />

// Allow CSS module imports
declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

// Allow SVG imports
declare module '*.svg' {
  const ReactComponent: React.FunctionComponent<React.SVGAttributes<SVGElement>>;
  export default ReactComponent;
}
