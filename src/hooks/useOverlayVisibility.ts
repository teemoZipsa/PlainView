import { useState, useCallback, useRef, useEffect } from 'react';

const HIDE_DELAY = 2000; // 2 seconds

export function useOverlayVisibility() {
  const [isVisible, setIsVisible] = useState(false);
  const [isOnOverlay, setIsOnOverlay] = useState(false);
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
      if (!isOnOverlay) {
        setIsVisible(false);
      }
    }, HIDE_DELAY);
  }, [clearHideTimer, isOnOverlay]);

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
    hideOverlay();
  }, [hideOverlay]);

  const handleOverlayEnter = useCallback(() => {
    setIsOnOverlay(true);
    clearHideTimer();
    setIsVisible(true);
  }, [clearHideTimer]);

  const handleOverlayLeave = useCallback(() => {
    setIsOnOverlay(false);
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
