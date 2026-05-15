import { useState, useCallback, useRef, useEffect } from 'react';

const HIDE_DELAY = 2000; // 2 seconds

export function useOverlayVisibility() {
  const [isVisible, setIsVisible] = useState(false);
  const isOnOverlayRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const startHideTimer = useCallback(() => {
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => {
      if (!isOnOverlayRef.current) {
        setIsVisible(false);
      }
    }, HIDE_DELAY);
  }, [clearHideTimer]);

  const showOverlay = useCallback(() => {
    setIsVisible(true);
    startHideTimer();
  }, [startHideTimer]);

  const hideOverlay = useCallback(() => {
    clearHideTimer();
    setIsVisible(false);
  }, [clearHideTimer]);

  const handleMouseMove = useCallback(() => {
    setIsVisible(true);
    startHideTimer();
  }, [startHideTimer]);

  const handleMouseLeave = useCallback(() => {
    isOnOverlayRef.current = false;
    hideOverlay();
  }, [hideOverlay]);

  const handleOverlayEnter = useCallback(() => {
    isOnOverlayRef.current = true;
    clearHideTimer();
    setIsVisible(true);
  }, [clearHideTimer]);

  const handleOverlayLeave = useCallback(() => {
    isOnOverlayRef.current = false;
    startHideTimer();
  }, [startHideTimer]);

  useEffect(() => {
    return () => clearHideTimer();
  }, [clearHideTimer]);

  return {
    isVisible,
    showOverlay,
    hideOverlay,
    handleMouseMove,
    handleMouseLeave,
    handleOverlayEnter,
    handleOverlayLeave,
  };
}
