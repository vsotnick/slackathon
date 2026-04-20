import { useRef, useState, useCallback, useEffect } from 'react';

/**
 * Horizontal resize hook for sidebar panels.
 *
 * @param initialWidth  Starting width in px
 * @param min           Minimum allowed width in px
 * @param max           Maximum allowed width in px
 * @param dir           'right' = dragging right grows panel (left sidebar)
 *                      'left'  = dragging left grows panel (right sidebar)
 */
export function useResize(
  initialWidth: number,
  min: number,
  max: number,
  dir: 'right' | 'left' = 'right',
) {
  const [width, setWidth] = useState(initialWidth);
  const resizing = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      resizing.current = true;
      startX.current = e.clientX;
      startW.current = width;
      e.preventDefault();
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [width],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const delta =
        dir === 'right'
          ? e.clientX - startX.current
          : startX.current - e.clientX;
      setWidth(Math.max(min, Math.min(max, startW.current + delta)));
    };

    const onUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dir, min, max]);

  return { width, onMouseDown };
}
