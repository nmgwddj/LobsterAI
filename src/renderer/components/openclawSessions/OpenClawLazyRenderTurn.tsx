import React, { useEffect, useRef, useState } from 'react';

interface OpenClawLazyRenderTurnProps extends React.HTMLAttributes<HTMLDivElement> {
  turnId: string;
  rootMargin?: number;
  alwaysRender?: boolean;
  children: React.ReactNode;
}

const heightCache = new Map<string, number>();

const OpenClawLazyRenderTurn: React.FC<OpenClawLazyRenderTurnProps> = ({
  turnId,
  rootMargin = 600,
  alwaysRender = false,
  children,
  style,
  ...restProps
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(alwaysRender);

  useEffect(() => {
    if (alwaysRender) {
      setIsVisible(true);
      return;
    }

    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      {
        rootMargin: `${rootMargin}px 0px ${rootMargin}px 0px`,
      },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [alwaysRender, rootMargin]);

  useEffect(() => {
    if (!isVisible) return;
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      const h = entry.contentRect.height;
      if (h > 0) {
        heightCache.set(turnId, h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isVisible, turnId]);

  const shouldRender = isVisible || alwaysRender;
  const cachedHeight = heightCache.get(turnId);

  return (
    <div
      ref={containerRef}
      {...restProps}
      style={{
        ...style,
        ...(!shouldRender && cachedHeight
          ? { height: cachedHeight, minHeight: cachedHeight }
          : undefined),
      }}
    >
      {shouldRender ? children : (
        <div style={{ height: cachedHeight || 80 }} className="bg-background" />
      )}
    </div>
  );
};

export default OpenClawLazyRenderTurn;
