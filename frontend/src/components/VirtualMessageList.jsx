import React, { useState, useEffect, useRef, useMemo } from "react";

const ESTIMATED_ROW_HEIGHT = 80; // Estimated height in pixels for a message bubble
const BUFFER_ITEMS = 25; // Number of items to render above and below the viewport

export function VirtualMessageList({
  messages,
  renderMessage,
  onScroll,
  containerRef,
  children
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [clientHeight, setClientHeight] = useState(0);
  const rafRef = useRef(null);

  // Measure container height on mount and resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setClientHeight(el.clientHeight);
    setScrollTop(el.scrollTop);

    const resizeObserver = new ResizeObserver((entries) => {
      if (entries[0]) {
        setClientHeight(entries[0].contentRect.height);
      }
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef]);

  // Handle scroll events and throttle updates using requestAnimationFrame
  const handleScroll = (e) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    rafRef.current = requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) {
        setScrollTop(el.scrollTop);
      }
    });

    if (onScroll) {
      onScroll(e);
    }
  };

  // If there are few messages, bypass virtualization to prevent any minor layout shifts
  const shouldVirtualize = messages.length > 100;

  const { visibleMessages, topPadding, bottomPadding, startIndex } = useMemo(() => {
    if (!shouldVirtualize) {
      return {
        visibleMessages: messages,
        topPadding: 0,
        bottomPadding: 0,
        startIndex: 0
      };
    }

    // Calculate virtual indexes
    const startIndex = Math.max(
      0,
      Math.floor(scrollTop / ESTIMATED_ROW_HEIGHT) - BUFFER_ITEMS
    );
    const endIndex = Math.min(
      messages.length,
      Math.floor((scrollTop + clientHeight) / ESTIMATED_ROW_HEIGHT) + BUFFER_ITEMS
    );

    const visible = messages.slice(startIndex, endIndex);
    const top = startIndex * ESTIMATED_ROW_HEIGHT;
    const bottom = (messages.length - endIndex) * ESTIMATED_ROW_HEIGHT;

    return {
      visibleMessages: visible,
      topPadding: top,
      bottomPadding: bottom,
      startIndex
    };
  }, [messages, scrollTop, clientHeight, shouldVirtualize]);

  return (
    <div
      className="messagesArea"
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        position: "relative"
      }}
    >
      {/* Top virtualization spacer */}
      {topPadding > 0 && <div style={{ height: `${topPadding}px`, flexShrink: 0 }} />}

      {/* Rendered visible messages */}
      {/*  Bolt: Replace O(n) indexOf lookup with O(1) index calculation to prevent main thread blocking during scroll */}
      {visibleMessages.map((msg, idx) => {
        const originalIndex = startIndex + idx;
        return renderMessage(msg, originalIndex);
      })}

      {/* Bottom virtualization spacer */}
      {bottomPadding > 0 && <div style={{ height: `${bottomPadding}px`, flexShrink: 0 }} />}
      {children}
    </div>
  );
}
export default VirtualMessageList;
